"""
FastAPI application entry point.
Multi-file DuckDB (per-file in-memory) + PostgreSQL (persistent).
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routes import upload, query, stats
from backend.routes import postgres as pg_routes
from backend.routes import data as data_routes
from backend.routes import files as files_routes
from backend.db import postgres as pg_db
from backend.db import duck


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Restore all previously uploaded CSVs into memory
    duck.restore_all()
    # Open PostgreSQL connection pool
    try:
        await pg_db.get_pool()
        print("✅ PostgreSQL pool ready")
    except Exception as e:
        print(f"⚠️  PostgreSQL unavailable: {e}")
    yield
    await pg_db.close_pool()
    print("PostgreSQL pool closed")


app = FastAPI(
    title="Conversational Data Intelligence Platform",
    description="Upload CSVs, ask NL questions, get data-backed answers. Powered by DuckDB + PostgreSQL + Llama 3.1.",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# File management
app.include_router(files_routes.router)

# DuckDB routes
app.include_router(upload.router,     tags=["DuckDB — Data"])
app.include_router(query.router,      tags=["DuckDB — Query"])
app.include_router(stats.router,      tags=["DuckDB — Stats"])
app.include_router(data_routes.router)

# PostgreSQL routes
app.include_router(pg_routes.router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "message": "Conversational Data Intelligence Platform v3",
        "docs": "/docs",
        "files": "/files",
    }
