"""
Data access routes — serve the full CSV dataset as JSON.

GET  /data              → full dataset (capped at 5000 rows for frontend)
GET  /data/sample       → first 20 rows
GET  /data/columns      → list of column names
GET  /data/column/{col} → all values for one column (for charting)
GET  /data/counts/{col} → value → count map for categorical columns (pie/bar ready)
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from backend.db import duck

router = APIRouter(prefix="/data", tags=["JSON Data"])


def _require_data():
    data = duck.get_json_data()
    if data is None:
        raise HTTPException(status_code=404, detail="No dataset loaded. Upload a CSV first.")
    return data


@router.get("")
async def get_data(limit: int = 5000):
    """Return the full dataset as JSON (capped at `limit` rows)."""
    data = _require_data()
    schema = duck.get_schema()
    return JSONResponse(content={
        "table_name": schema["table_name"],
        "total_rows": len(data),
        "returned_rows": min(len(data), limit),
        "columns": [c["name"] for c in schema["columns"]],
        "rows": data[:limit],
    })


@router.get("/sample")
async def get_sample(n: int = 20):
    """Return the first N rows as JSON."""
    data = _require_data()
    return JSONResponse(content={"rows": data[:n], "total_rows": len(data)})


@router.get("/columns")
async def get_columns():
    """Return column names and types."""
    schema = duck.get_schema()
    if schema is None:
        raise HTTPException(status_code=404, detail="No dataset loaded.")
    return {"columns": schema["columns"]}


@router.get("/column/{col_name}")
async def get_column_values(col_name: str):
    """Return all values for a single column as an array — ready for Chart.js."""
    _require_data()
    schema = duck.get_schema()
    valid_cols = [c["name"] for c in schema["columns"]]
    if col_name not in valid_cols:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{col_name}' not found. Available: {valid_cols}"
        )
    values = duck.get_column_values(col_name)
    return JSONResponse(content={"column": col_name, "values": values, "count": len(values)})


@router.get("/counts/{col_name}")
async def get_value_counts(col_name: str):
    """
    Return value → count mapping for a column.
    Perfect for bar/pie charts — no LLM needed.
    Example: { "Yes": 1869, "No": 5174 }
    """
    _require_data()
    schema = duck.get_schema()
    valid_cols = [c["name"] for c in schema["columns"]]
    if col_name not in valid_cols:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{col_name}' not found. Available: {valid_cols}"
        )
    counts = duck.get_column_counts(col_name)
    labels = list(counts.keys())
    values = list(counts.values())
    return JSONResponse(content={
        "column": col_name,
        "labels": labels,
        "values": values,
        "total": sum(values),
    })
