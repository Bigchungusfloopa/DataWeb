"""
PostgreSQL-specific routes:
  GET  /pg/tables              — list all tables in the database
  GET  /pg/schema/{table}      — schema + sample for a table
  GET  /pg/stats/{table}       — aggregate stats for a table
  POST /pg/query               — run NL query against a PostgreSQL table
  POST /pg/upload/{table}      — upload CSV into a named PG table
  GET  /pg/health              — PostgreSQL connection check
"""
import io
import pandas as pd
from fastapi import APIRouter, HTTPException, File, UploadFile, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from backend.db import postgres as pg
from backend.llm import ollama_client, prompt_builder

router = APIRouter(prefix="/pg", tags=["PostgreSQL"])


# ── Health ────────────────────────────────────────────────────────────────────
@router.get("/health")
async def pg_health():
    ok = await pg.check_connection()
    tables = await pg.list_tables() if ok else []
    return {"postgres": "connected" if ok else "offline", "tables": tables}


# ── Tables ────────────────────────────────────────────────────────────────────
@router.get("/tables")
async def list_tables():
    try:
        tables = await pg.list_tables()
        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"PostgreSQL error: {e}")


# ── Schema ────────────────────────────────────────────────────────────────────
@router.get("/schema/{table_name}")
async def get_schema(table_name: str = Path(...)):
    try:
        return await pg.get_table_schema(table_name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Stats ─────────────────────────────────────────────────────────────────────
@router.get("/stats/{table_name}")
async def get_stats(table_name: str = Path(...)):
    try:
        return await pg.get_pg_stats(table_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Upload CSV → PG Table ─────────────────────────────────────────────────────
@router.post("/upload")
async def upload_to_pg(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files supported.")

    contents = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"CSV parse error: {e}")

    # Use filename (without .csv) as table name
    table_name = file.filename.replace(".csv", "").replace(" ", "_").lower()[:40]

    try:
        result = await pg.load_dataframe(df, table_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PostgreSQL load error: {e}")

    return JSONResponse(content={
        "message": f"Loaded {result['row_count']} rows into PostgreSQL table '{table_name}'.",
        "schema": result,
    })


# ── NL Query against PG ───────────────────────────────────────────────────────
class PGQueryRequest(BaseModel):
    question: str
    table_name: str


@router.post("/query")
async def pg_query(req: PGQueryRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is empty.")

    # Build schema context
    try:
        schema = await pg.get_table_schema(req.table_name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Table '{req.table_name}' not found: {e}")

    # Step 1: Generate SQL
    sql_prompt = prompt_builder.build_sql_prompt(question, schema)
    try:
        sql = await ollama_client.generate_sql(sql_prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    # Step 2: Execute on PostgreSQL
    try:
        rows, columns = await pg.execute_query(sql)
    except Exception as e:
        return JSONResponse(status_code=422, content={
            "error": f"SQL execution failed: {e}",
            "sql": sql,
            "rows": [], "columns": [],
            "explanation": "The generated SQL had an error. Try rephrasing your question.",
            "chart_type": "none",
            "source": "postgresql",
        })

    # Step 3: Explain
    try:
        explain_prompt = prompt_builder.build_explanation_prompt(question, sql, rows)
        explanation = await ollama_client.explain_results(explain_prompt)
    except Exception:
        explanation = "Results retrieved from PostgreSQL."

    chart_type = prompt_builder.suggest_chart_type(columns, rows)

    return JSONResponse(content={
        "sql": sql,
        "columns": columns,
        "rows": rows[:100],
        "row_count": len(rows),
        "explanation": explanation,
        "chart_type": chart_type,
        "source": "postgresql",
    })
