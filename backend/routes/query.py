"""
POST /query  — three-way routed pipeline scoped to a file_id:
  SQL     → NL → SQL → DuckDB → LLM explain
  COMPUTE → NL → computation-aware SQL → DuckDB → LLM explain
  GENERAL → LLM answers directly (no DB needed)
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, List
import uuid
import json
from pathlib import Path
from backend.db import duck
from backend.llm import ollama_client, prompt_builder

router = APIRouter()

SESSIONS_FILE = Path(__file__).parent.parent / "data" / "sessions.json"

def _load_sessions() -> dict:
    if SESSIONS_FILE.exists():
        try:
            return json.loads(SESSIONS_FILE.read_text())
        except Exception:
            pass
    return {}

def _save_sessions(sessions: dict):
    SESSIONS_FILE.parent.mkdir(exist_ok=True)
    SESSIONS_FILE.write_text(json.dumps(sessions, indent=2))


class QueryRequest(BaseModel):
    question: str
    file_id:  Optional[str] = None
    session_id: Optional[str] = None


@router.post("/query")
async def run_query(req: QueryRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    file_id = req.file_id
    schema  = duck.get_schema(file_id) if file_id else None

    session_id = req.session_id or str(uuid.uuid4())
    
    sessions_db = _load_sessions()
    
    if session_id not in sessions_db:
        sessions_db[session_id] = {
            "id": session_id,
            "title": question[:30] + ("..." if len(question) > 30 else ""),
            "file_id": file_id or "global",
            "messages": []
        }
    
    history_obj = sessions_db[session_id]["messages"]
    
    # helper for converting history_obj into prompt_builder format
    # prompt_builder expects [{"role": "user"|"ai", "content": "..."}]
    history = [{"role": m["role"], "content": m.get("content", m.get("explanation", ""))[:1000]} for m in history_obj]

    # ── Step 1: Classify ─────────────────────────────────────────────────
    schema_cols = [c["name"] for c in schema["columns"]] if schema else []
    classify_prompt = prompt_builder.build_classify_prompt(
        question,
        schema_available=schema is not None,
        schema_columns=schema_cols,
        history=history,
    )
    try:
        route = await ollama_client.classify_question(classify_prompt)
    except Exception:
        route = "SQL"

    # ── GENERAL route ─────────────────────────────────────────────────────
    if route == "GENERAL":
        gen_prompt = prompt_builder.build_general_answer_prompt(question, schema, history)
        try:
            answer = await ollama_client.answer_general(gen_prompt)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM error: {e}")
            
        sessions_db[session_id]["messages"].append({"role": "user", "content": question})
        
        result_payload = {
            "sql": None, "columns": [], "rows": [], "row_count": 0,
            "explanation": answer, "chart_type": "none",
            "source": "llm", "route": "general", "session_id": session_id,
        }
        sessions_db[session_id]["messages"].append({"role": "ai", "result": result_payload})
        _save_sessions(sessions_db)
        
        return JSONResponse(content=result_payload)

    # ── SQL / COMPUTE need a loaded file ─────────────────────────────────
    if schema is None:
        raise HTTPException(
            status_code=404,
            detail="No dataset loaded. Upload a CSV and select it first.",
        )

    # ── Step 2: Generate SQL ──────────────────────────────────────────────
    sql_prompt = (
        prompt_builder.build_compute_sql_prompt(question, schema, history)
        if route == "COMPUTE"
        else prompt_builder.build_sql_prompt(question, schema, history)
    )
    try:
        sql = await ollama_client.generate_sql(sql_prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error (SQL gen): {e}")

    if not sql:
        raise HTTPException(status_code=500, detail="LLM returned an empty SQL query.")

    # ── Step 3: Execute (with 1 auto-retry) ──────────────────────────────
    rows, columns, exec_error = None, None, None
    try:
        rows, columns = duck.execute_query(sql, file_id)
    except Exception as e:
        exec_error = str(e)

    if exec_error:
        try:
            retry_prompt = prompt_builder.build_retry_sql_prompt(question, schema, sql, exec_error)
            sql_retry = await ollama_client.generate_sql(retry_prompt)
            if sql_retry:
                rows, columns = duck.execute_query(sql_retry, file_id)
                sql = sql_retry
                exec_error = None
        except Exception as e2:
            exec_error = f"Retry also failed: {e2}"

    if exec_error:
        return JSONResponse(status_code=422, content={
            "error": exec_error, "sql": sql, "rows": [], "columns": [],
            "explanation": "I couldn't run that query. Try rephrasing — mention the exact column name.",
            "chart_type": "none", "source": "duckdb", "route": route.lower(),
            "session_id": session_id,
        })

    # ── Step 4: Explain ───────────────────────────────────────────────────
    try:
        explain_prompt = prompt_builder.build_explanation_prompt(question, sql, rows)
        explanation = await ollama_client.explain_results(explain_prompt)
    except Exception:
        explanation = "Here are the results from your data."

    chart_type = prompt_builder.suggest_chart_type(columns, rows)
    
    sessions_db[session_id]["messages"].append({"role": "user", "content": question})
    
    result_payload = {
        "sql": sql, "columns": columns, "rows": rows[:100],
        "row_count": len(rows), "explanation": explanation,
        "chart_type": chart_type, "source": "duckdb", "route": route.lower(),
        "session_id": session_id,
    }
    
    sessions_db[session_id]["messages"].append({"role": "ai", "result": result_payload})
    _save_sessions(sessions_db)

    return JSONResponse(content=result_payload)


@router.get("/sessions")
async def get_sessions(file_id: Optional[str] = None):
    sessions = _load_sessions()
    result = list(sessions.values())
    if file_id:
        result = [s for s in result if s.get("file_id") == file_id]
    return JSONResponse(content=result)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    sessions = _load_sessions()
    if session_id in sessions:
        del sessions[session_id]
        _save_sessions(sessions)
        return {"message": "session deleted"}
    raise HTTPException(status_code=404, detail="session not found")


@router.get("/health")
async def health():
    from backend.db import postgres as pg_db
    ollama_ok = await ollama_client.check_ollama_health()
    pg_ok     = await pg_db.check_connection()
    files     = duck.list_files()
    pg_tables = []
    if pg_ok:
        try:
            pg_tables = await pg_db.list_tables()
        except Exception:
            pass
    return {
        "status": "ok",
        "ollama": "connected" if ollama_ok else "offline",
        "llm_model": "llama3.1:8b",
        "duckdb": {
            "files_loaded": len([f for f in files if f["loaded"]]),
            "total_files":  len(files),
        },
        "postgresql": {
            "connected": pg_ok,
            "tables": [t["table_name"] for t in pg_tables],
        },
    }
