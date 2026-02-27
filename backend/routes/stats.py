"""
GET /stats — aggregate stats from the current DuckDB table.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from backend.db import duck

router = APIRouter()


@router.get("/stats")
async def get_stats():
    schema = duck.get_schema()
    if schema is None:
        raise HTTPException(status_code=404, detail="No dataset loaded.")

    table = duck.get_current_table()
    conn = duck.get_conn()

    stats = {
        "table_name": table,
        "row_count": schema["row_count"],
        "column_count": len(schema["columns"]),
        "columns": schema["columns"],
    }

    # Numeric column summaries
    numeric_cols = [
        c["name"] for c in schema["columns"]
        if c["type"] in ("BIGINT", "INTEGER", "DOUBLE", "FLOAT", "DECIMAL", "HUGEINT")
        or "INT" in c["type"] or "FLOAT" in c["type"] or "DOUBLE" in c["type"]
    ]

    numeric_stats = {}
    for col in numeric_cols[:5]:  # limit to first 5 numeric cols
        try:
            row = conn.execute(
                f"SELECT MIN({col}), MAX({col}), AVG({col}) FROM {table}"
            ).fetchone()
            numeric_stats[col] = {
                "min": round(row[0], 2) if row[0] is not None else None,
                "max": round(row[1], 2) if row[1] is not None else None,
                "avg": round(row[2], 2) if row[2] is not None else None,
            }
        except Exception:
            pass

    stats["numeric_stats"] = numeric_stats

    # Categorical column value counts (top 5 per col, limit to first 3 cols)
    categorical_cols = [
        c["name"] for c in schema["columns"]
        if c["type"] in ("VARCHAR", "TEXT", "STRING") and c["name"] not in numeric_cols
    ]

    categorical_stats = {}
    for col in categorical_cols[:3]:
        try:
            rows = conn.execute(
                f"SELECT {col}, COUNT(*) as count FROM {table} GROUP BY {col} ORDER BY count DESC LIMIT 5"
            ).fetchall()
            categorical_stats[col] = [{"value": r[0], "count": r[1]} for r in rows]
        except Exception:
            pass

    stats["categorical_stats"] = categorical_stats

    return JSONResponse(content=stats)
