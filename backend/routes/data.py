"""
JSON data layer — serve the raw CSV dataset as JSON, scoped to a file_id.

GET  /data?file_id=              → full dataset (capped at 5000 rows)
GET  /data/sample?file_id=       → first 20 rows
GET  /data/columns?file_id=      → column names + types
GET  /data/column/{col}?file_id= → all values for one column
GET  /data/counts/{col}?file_id= → value → count map (pie/bar ready)
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from backend.db import duck

router = APIRouter(prefix="/data", tags=["JSON Data"])


def _require(file_id: str):
    data = duck.get_json_data(file_id)
    schema = duck.get_schema(file_id)
    if data is None or schema is None:
        raise HTTPException(
            status_code=404,
            detail=f"No dataset for file_id '{file_id}'. Upload a CSV first."
        )
    return data, schema


@router.get("")
async def get_data(file_id: str = Query(...), limit: int = 5000):
    data, schema = _require(file_id)
    return JSONResponse(content={
        "file_id":       file_id,
        "filename":      schema.get("filename", ""),
        "total_rows":    len(data),
        "returned_rows": min(len(data), limit),
        "columns":       [c["name"] for c in schema["columns"]],
        "rows":          data[:limit],
    })


@router.get("/sample")
async def get_sample(file_id: str = Query(...), n: int = 20):
    data, _ = _require(file_id)
    return JSONResponse(content={"rows": data[:n], "total_rows": len(data)})


@router.get("/columns")
async def get_columns(file_id: str = Query(...)):
    schema = duck.get_schema(file_id)
    if schema is None:
        raise HTTPException(status_code=404, detail="No dataset loaded.")
    return {"columns": schema["columns"]}


@router.get("/column/{col_name}")
async def get_column_values(col_name: str, file_id: str = Query(...)):
    _, schema = _require(file_id)
    valid = [c["name"] for c in schema["columns"]]
    if col_name not in valid:
        raise HTTPException(status_code=400, detail=f"Column '{col_name}' not found. Available: {valid}")
    values = duck.get_column_values(file_id, col_name)
    return JSONResponse(content={"column": col_name, "values": values, "count": len(values)})


@router.get("/counts/{col_name}")
async def get_value_counts(col_name: str, file_id: str = Query(...)):
    _, schema = _require(file_id)
    valid = [c["name"] for c in schema["columns"]]
    if col_name not in valid:
        raise HTTPException(status_code=400, detail=f"Column '{col_name}' not found. Available: {valid}")
    counts = duck.get_column_counts(file_id, col_name)
    labels = list(counts.keys())
    values = list(counts.values())
    return JSONResponse(content={
        "column": col_name, "labels": labels, "values": values, "total": sum(values),
    })
