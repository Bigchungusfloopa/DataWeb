"""
POST /upload  — accept a CSV, assign a file_id, register in DuckDB
GET  /schema  — kept for backwards compat (requires ?file_id=)
"""
import io
import uuid
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

    # Generate a stable unique id for this file
    file_id = str(uuid.uuid4())
    original_name = file.filename

    schema = duck.register_dataframe(df, file_id, original_name)

    return JSONResponse(content={
        "file_id": file_id,
        "message": f"Loaded {schema['row_count']} rows from '{original_name}'.",
        "schema": schema,
    })


@router.get("/schema")
async def get_schema(file_id: str):
    schema = duck.get_schema(file_id)
    if schema is None:
        raise HTTPException(
            status_code=404,
            detail=f"No dataset for file_id '{file_id}'. Upload a CSV first."
        )
    return schema
