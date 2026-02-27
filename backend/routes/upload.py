"""
POST /upload  — accept a CSV file, register it in DuckDB
GET  /schema  — return column names, types, row count, sample rows
"""
import io
import pandas as pd
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from backend.db import duck

router = APIRouter()


@router.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    contents = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {e}")

    # Sanitize column names (no spaces, lowercase)
    df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]

    table_name = "uploaded"
    schema = duck.register_dataframe(df, table_name)

    return JSONResponse(content={
        "message": f"Loaded {schema['row_count']} rows into table '{table_name}'.",
        "schema": schema,
    })


@router.get("/schema")
async def get_schema():
    schema = duck.get_schema()
    if schema is None:
        raise HTTPException(status_code=404, detail="No dataset loaded. Please upload a CSV first.")
    return schema
