"""
POST /query — full NL → SQL → DuckDB → LLM explanation pipeline.
Includes one automatic retry with error feedback if the first SQL fails.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from backend.db import duck
from backend.llm import ollama_client, prompt_builder

router = APIRouter()


class QueryRequest(BaseModel):
    question: str


@router.post("/query")
async def run_query(req: QueryRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    schema = duck.get_schema()
    if schema is None:
        raise HTTPException(status_code=404, detail="No dataset loaded. Please upload a CSV first.")

    # ── Step 1: Generate SQL ───────────────────────────────────────────────
    sql_prompt = prompt_builder.build_sql_prompt(question, schema)
    try:
        sql = await ollama_client.generate_sql(sql_prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error (SQL gen): {e}")

    if not sql:
        raise HTTPException(status_code=500, detail="LLM returned an empty SQL query.")

    # ── Step 2: Execute on DuckDB (with 1 automatic retry on failure) ──────
    rows, columns, exec_error = None, None, None
    try:
        rows, columns = duck.execute_query(sql)
    except Exception as e:
        exec_error = str(e)

    # ── Step 2b: Retry with error feedback if first attempt failed ─────────
    if exec_error is not None:
        try:
            retry_prompt = prompt_builder.build_retry_sql_prompt(question, schema, sql, exec_error)
            sql_retry = await ollama_client.generate_sql(retry_prompt)
            if sql_retry:
                try:
                    rows, columns = duck.execute_query(sql_retry)
                    sql = sql_retry   # use the fixed SQL for display
                    exec_error = None # cleared — retry succeeded
                except Exception as e2:
                    exec_error = f"Retry also failed: {e2}. Original: {exec_error}"
        except Exception:
            pass  # LLM retry failed — keep original error

    # ── Still failed after retry → return friendly error ──────────────────
    if exec_error is not None:
        return JSONResponse(
            status_code=422,
            content={
                "error": exec_error,
                "sql": sql,
                "rows": [],
                "columns": [],
                "explanation": (
                    "I couldn't execute that query on your data. "
                    "Try rephrasing — for example, use column names shown in the schema."
                ),
                "chart_type": "none",
                "source": "duckdb",
            },
        )

    # ── Step 3: Explain results ────────────────────────────────────────────
    try:
        explain_prompt = prompt_builder.build_explanation_prompt(question, sql, rows)
        explanation = await ollama_client.explain_results(explain_prompt)
    except Exception:
        explanation = "Here are the results from your data."

    # ── Step 4: Suggest chart type ─────────────────────────────────────────
    chart_type = prompt_builder.suggest_chart_type(columns, rows)

    return JSONResponse(content={
        "sql": sql,
        "columns": columns,
        "rows": rows[:100],
        "row_count": len(rows),
        "explanation": explanation,
        "chart_type": chart_type,
        "source": "duckdb",
    })


@router.get("/health")
async def health():
    from backend.db import postgres as pg_db
    ollama_ok = await ollama_client.check_ollama_health()
    pg_ok = await pg_db.check_connection()
    schema = duck.get_schema()
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
            "dataset_loaded": schema is not None,
            "table": schema["table_name"] if schema else None,
            "rows": schema["row_count"] if schema else 0,
        },
        "postgresql": {
            "connected": pg_ok,
            "tables": [t["table_name"] for t in pg_tables],
        },
    }
