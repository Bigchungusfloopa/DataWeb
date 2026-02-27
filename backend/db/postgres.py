"""
PostgreSQL async connection manager using asyncpg.
Manages the connection pool and exposes helpers for schema/query operations.
"""
import asyncpg
import pandas as pd
import json
from typing import Optional

# ── Connection pool singleton ─────────────────────────────────────────────────
_pool: Optional[asyncpg.Pool] = None

# PostgreSQL DSN — default to local socket auth (no password on homebrew installs)
PG_DSN = "postgresql://localhost:5432/datachat"

# Tracks tables created this session
_pg_tables: list[str] = []


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(PG_DSN, min_size=1, max_size=5)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── Table operations ─────────────────────────────────────────────────────────

async def load_dataframe(df: pd.DataFrame, table_name: str) -> dict:
    """Create/replace a PostgreSQL table from a pandas DataFrame."""
    pool = await get_pool()

    # Sanitise column names
    df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]

    # Map pandas dtypes → PostgreSQL types
    def pg_type(dtype) -> str:
        s = str(dtype)
        if "int" in s:  return "BIGINT"
        if "float" in s: return "DOUBLE PRECISION"
        return "TEXT"

    col_defs = ", ".join(f'"{c}" {pg_type(df[c].dtype)}' for c in df.columns)

    async with pool.acquire() as conn:
        await conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
        await conn.execute(f'CREATE TABLE "{table_name}" ({col_defs})')

        # Bulk insert using copy
        rows = [tuple(
            None if pd.isna(v) else (int(v) if isinstance(v, float) and v.is_integer() else v)
            for v in row
        ) for row in df.itertuples(index=False, name=None)]

        await conn.copy_records_to_table(
            table_name,
            records=rows,
            columns=list(df.columns),
        )

    row_count = int(df.shape[0])
    if table_name not in _pg_tables:
        _pg_tables.append(table_name)

    return {
        "table_name": table_name,
        "row_count": row_count,
        "columns": [{"name": c, "type": pg_type(df[c].dtype)} for c in df.columns],
    }


async def list_tables() -> list[dict]:
    """List all user-created tables in the datachat database."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT table_name,
                   pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
            """
        )
    return [dict(r) for r in rows]


async def get_table_schema(table_name: str) -> dict:
    """Return column info and sample rows for a PG table."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        cols = await conn.fetch(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
            """,
            table_name,
        )
        count_row = await conn.fetchrow(f'SELECT COUNT(*) FROM "{table_name}"')
        sample = await conn.fetch(f'SELECT * FROM "{table_name}" LIMIT 5')

    return {
        "table_name": table_name,
        "row_count": count_row[0],
        "columns": [{"name": r["column_name"], "type": r["data_type"]} for r in cols],
        "sample": [dict(r) for r in sample],
    }


async def execute_query(sql: str) -> tuple[list[dict], list[str]]:
    """Run a read SQL query on PostgreSQL and return (rows, columns)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)
    if not rows:
        return [], []
    columns = list(rows[0].keys())
    return [_serialize_row(dict(r)) for r in rows], columns


async def get_pg_stats(table_name: str) -> dict:
    """Compute aggregate stats for a PostgreSQL table."""
    pool = await get_pool()
    schema = await get_table_schema(table_name)

    numeric_types = {"bigint", "integer", "double precision", "numeric", "real"}
    numeric_cols = [c["name"] for c in schema["columns"] if c["type"].lower() in numeric_types]
    text_cols = [c["name"] for c in schema["columns"] if c["type"].lower() in {"text", "character varying", "varchar"}]

    numeric_stats = {}
    async with (await get_pool()).acquire() as conn:
        for col in numeric_cols[:5]:
            row = await conn.fetchrow(f'SELECT MIN("{col}"), MAX("{col}"), AVG("{col}") FROM "{table_name}"')
            numeric_stats[col] = {
                "min": round(float(row[0]), 2) if row[0] else None,
                "max": round(float(row[1]), 2) if row[1] else None,
                "avg": round(float(row[2]), 2) if row[2] else None,
            }

        cat_stats = {}
        for col in text_cols[:3]:
            rows = await conn.fetch(
                f'SELECT "{col}", COUNT(*) AS cnt FROM "{table_name}" GROUP BY "{col}" ORDER BY cnt DESC LIMIT 5'
            )
            cat_stats[col] = [{"value": r[col], "count": r["cnt"]} for r in rows]

    return {
        **schema,
        "numeric_stats": numeric_stats,
        "categorical_stats": cat_stats,
    }


async def check_connection() -> bool:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception:
        return False


def _serialize_row(row: dict) -> dict:
    """Make asyncpg row JSON-serializable (handle Decimal, date, etc.)."""
    result = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        elif hasattr(v, "__float__"):
            result[k] = float(v)
        else:
            result[k] = v
    return result
