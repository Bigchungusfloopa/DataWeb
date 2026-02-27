"""
GET  /files          — list all uploaded files
DELETE /files/{id}   — remove a file
GET  /files/{id}/schema — schema for a specific file
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from backend.db import duck

router = APIRouter(prefix="/files", tags=["Files"])


@router.get("")
async def list_files():
    return JSONResponse(content=duck.list_files())


@router.delete("/{file_id}")
async def delete_file(file_id: str):
    files = {f["file_id"]: f for f in duck.list_files()}
    if file_id not in files:
        raise HTTPException(status_code=404, detail=f"File '{file_id}' not found.")
    duck.delete_file(file_id)
    return {"message": f"File '{files[file_id]['filename']}' deleted."}


@router.get("/{file_id}/schema")
async def get_file_schema(file_id: str):
    schema = duck.get_schema(file_id)
    if schema is None:
        raise HTTPException(status_code=404, detail=f"No schema for file '{file_id}'.")
    return schema
