"""
DuckDB connection manager.
Singleton in-memory database — all uploaded tables live here for the session.
Also maintains a JSON copy of the dataset for fast chart data access.
"""
import duckdb
import pandas as pd
import math
from typing import Optional

# ---------------------------------------------------------------------------
# Singleton connection + caches
# ---------------------------------------------------------------------------
_conn: Optional[duckdb.DuckDBPyConnection] = None
_current_table: Optional[str] = None
_schema_cache: Optional[dict] = None
_json_data: Optional[list[dict]] = None   # full dataset as list of dicts


def get_conn() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        _conn = duckdb.connect(database=":memory:")
    return _conn


def _sanitize(val):
    """Make a value JSON-safe (NaN/Inf → None, numeric types preserved)."""
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    return val


def register_dataframe(df: pd.DataFrame, table_name: str = "uploaded") -> dict:
    """Register a pandas DataFrame as a DuckDB table, cache schema and JSON."""
    global _current_table, _schema_cache, _json_data

    # Sanitise column names (lowercase, underscores)
    df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]

    conn = get_conn()
    conn.execute(f'DROP TABLE IF EXISTS "{table_name}"')
    conn.execute(f'CREATE TABLE "{table_name}" AS SELECT * FROM df')

    _current_table = table_name

    # Schema metadata
    cols_info = conn.execute(
        f"SELECT column_name, data_type FROM information_schema.columns "
        f"WHERE table_name = '{table_name}' ORDER BY ordinal_position"
    ).fetchall()

    sample = (
        conn.execute(f'SELECT * FROM "{table_name}" LIMIT 15')
        .df()
        .to_dict(orient="records")
    )

    _schema_cache = {
        "table_name": table_name,
        "row_count": int(conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]),
        "columns": [{"name": c[0], "type": c[1]} for c in cols_info],
        "sample": sample,
    }

    # ── JSON cache — full dataset ──────────────────────────────────────────
    # Convert all rows to Python-native types for JSON serialisation
    raw = conn.execute(f'SELECT * FROM "{table_name}"').df()
    _json_data = [
        {k: _sanitize(v) for k, v in row.items()}
        for row in raw.to_dict(orient="records")
    ]

    return _schema_cache


def get_schema() -> Optional[dict]:
    return _schema_cache


def get_current_table() -> Optional[str]:
    return _current_table


def get_json_data() -> Optional[list[dict]]:
    """Return the full dataset as a list of JSON-safe dicts."""
    return _json_data


def get_column_values(column: str) -> list:
    """Return every value for a single column as a plain Python list."""
    if _json_data is None:
        return []
    return [row.get(column) for row in _json_data]


def get_column_counts(column: str) -> dict:
    """Return value → count mapping for a categorical column."""
    vals = get_column_values(column)
    counts: dict = {}
    for v in vals:
        key = str(v) if v is not None else "null"
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda x: -x[1]))


def execute_query(sql: str) -> tuple[list[dict], list[str]]:
    """Execute a SQL query and return (rows as list of dicts, column names)."""
    conn = get_conn()
    result = conn.execute(sql).df()
    # Sanitise floats in result too
    rows = [
        {k: _sanitize(v) for k, v in row.items()}
        for row in result.to_dict(orient="records")
    ]
    return rows, list(result.columns)
