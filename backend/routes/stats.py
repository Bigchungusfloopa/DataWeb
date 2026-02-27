"""
GET /stats?file_id= — aggregate stats from a DuckDB table scoped to a file.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from backend.db import duck

router = APIRouter()


@router.get("/stats")
async def get_stats(file_id: str = Query(..., description="UUID of the uploaded file")):
    schema = duck.get_schema(file_id)
    if schema is None:
        raise HTTPException(status_code=404, detail=f"No dataset for file_id '{file_id}'.")

    conn = duck._registry[file_id]["conn"]
    table = schema["table_name"]

    stats = {
        "file_id":      file_id,
        "filename":     schema.get("filename", ""),
        "table_name":   table,
        "row_count":    schema["row_count"],
        "column_count": len(schema["columns"]),
        "columns":      schema["columns"],
    }

    # Numeric column summaries
    numeric_cols = [
        c["name"] for c in schema["columns"]
        if any(t in c["type"].upper() for t in ("INT", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "HUGEINT"))
    ]

    numeric_stats = {}
    for col in numeric_cols[:6]:
        try:
            row = conn.execute(
                f'SELECT MIN("{col}"), MAX("{col}"), AVG("{col}") FROM "{table}"'
            ).fetchone()
            numeric_stats[col] = {
                "min": round(row[0], 2) if row[0] is not None else None,
                "max": round(row[1], 2) if row[1] is not None else None,
                "avg": round(row[2], 2) if row[2] is not None else None,
            }
        except Exception:
            pass

    stats["numeric_stats"] = numeric_stats

    # Categorical value counts (top 5 per col, first 4 cols)
    categorical_cols = [
        c["name"] for c in schema["columns"]
        if any(t in c["type"].upper() for t in ("VARCHAR", "TEXT", "STRING", "CHAR"))
        and c["name"] not in numeric_cols
    ]

    categorical_stats = {}
    for col in categorical_cols[:4]:
        try:
            rows = conn.execute(
                f'SELECT "{col}", COUNT(*) as cnt FROM "{table}" '
                f'GROUP BY "{col}" ORDER BY cnt DESC LIMIT 5'
            ).fetchall()
            categorical_stats[col] = [{"value": r[0], "count": r[1]} for r in rows]
        except Exception:
            pass

    stats["categorical_stats"] = categorical_stats
    return JSONResponse(content=stats)
