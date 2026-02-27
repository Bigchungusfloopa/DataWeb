"""
DuckDB multi-file manager.
Each uploaded CSV gets its own file_id (UUID). All state is keyed by file_id.
Data is persisted on disk (CSV + metadata) and auto-restored on server start.
"""
import duckdb
import pandas as pd
import math
import json
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DATA_DIR   = Path(__file__).parent.parent / "data"
META_PATH  = DATA_DIR / "files.json"

DATA_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# In-memory registry: file_id → { conn, schema, json_data }
# ---------------------------------------------------------------------------
_registry: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Metadata helpers (persisted to files.json)
# ---------------------------------------------------------------------------
def _load_meta() -> dict:
    if META_PATH.exists():
        try:
            return json.loads(META_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_meta(meta: dict):
    META_PATH.write_text(json.dumps(meta, indent=2))


def _sanitize(val):
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    return val


# ---------------------------------------------------------------------------
# Startup restore
# ---------------------------------------------------------------------------
def restore_all():
    """On server start, reload every saved CSV back into memory."""
    meta = _load_meta()
    for file_id, info in meta.items():
        csv_path = DATA_DIR / f"{file_id}.csv"
        if csv_path.exists() and file_id not in _registry:
            try:
                df = pd.read_csv(csv_path)
                df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]
                _load_df(file_id, df, info["filename"])
                print(f"✅ Restored [{info['filename']}] id={file_id[:8]}…")
            except Exception as e:
                print(f"⚠️  Could not restore {file_id}: {e}")


# ---------------------------------------------------------------------------
# Core loading
# ---------------------------------------------------------------------------
def _load_df(file_id: str, df: pd.DataFrame, filename: str) -> dict:
    """Register DataFrame into a fresh in-memory DuckDB for this file_id."""
    conn = duckdb.connect(database=":memory:")
    conn.execute('CREATE TABLE "uploaded" AS SELECT * FROM df')

    cols_info = conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_name = 'uploaded' ORDER BY ordinal_position"
    ).fetchall()

    row_count = int(conn.execute('SELECT COUNT(*) FROM "uploaded"').fetchone()[0])
    sample = conn.execute('SELECT * FROM "uploaded" LIMIT 15').df().to_dict(orient="records")

    schema = {
        "file_id":    file_id,
        "filename":   filename,
        "table_name": "uploaded",
        "row_count":  row_count,
        "columns":    [{"name": c[0], "type": c[1]} for c in cols_info],
        "sample":     sample,
    }

    raw = conn.execute('SELECT * FROM "uploaded"').df()
    json_data = [
        {k: _sanitize(v) for k, v in row.items()}
        for row in raw.to_dict(orient="records")
    ]

    _registry[file_id] = {
        "conn":      conn,
        "schema":    schema,
        "json_data": json_data,
    }
    return schema


def register_dataframe(df: pd.DataFrame, file_id: str, filename: str) -> dict:
    """Register a new CSV upload. Persists CSV + updates metadata."""
    df.columns = [c.strip().replace(" ", "_").lower() for c in df.columns]
    schema = _load_df(file_id, df, filename)

    # Persist CSV
    csv_path = DATA_DIR / f"{file_id}.csv"
    df.to_csv(csv_path, index=False)

    # Update metadata
    meta = _load_meta()
    meta[file_id] = {
        "filename":   filename,
        "row_count":  schema["row_count"],
        "columns":    [c["name"] for c in schema["columns"]],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_meta(meta)

    return schema


# ---------------------------------------------------------------------------
# Accessors
# ---------------------------------------------------------------------------
def get_schema(file_id: str) -> Optional[dict]:
    if file_id in _registry:
        return _registry[file_id]["schema"]
    return None


def get_json_data(file_id: str) -> Optional[list[dict]]:
    if file_id in _registry:
        return _registry[file_id]["json_data"]
    return None


def get_column_values(file_id: str, column: str) -> list:
    data = get_json_data(file_id)
    if not data:
        return []
    return [row.get(column) for row in data]


def get_column_counts(file_id: str, column: str) -> dict:
    vals = get_column_values(file_id, column)
    counts: dict = {}
    for v in vals:
        key = str(v) if v is not None else "null"
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda x: -x[1]))


def execute_query(sql: str, file_id: str) -> tuple[list[dict], list[str]]:
    if file_id not in _registry:
        raise ValueError(f"No dataset loaded for file_id '{file_id}'.")
    conn = _registry[file_id]["conn"]
    result = conn.execute(sql).df()
    rows = [
        {k: _sanitize(v) for k, v in row.items()}
        for row in result.to_dict(orient="records")
    ]
    return rows, list(result.columns)


def delete_file(file_id: str):
    """Remove file from registry, disk CSV, and metadata."""
    _registry.pop(file_id, None)

    csv_path = DATA_DIR / f"{file_id}.csv"
    if csv_path.exists():
        csv_path.unlink()

    meta = _load_meta()
    meta.pop(file_id, None)
    _save_meta(meta)


def list_files() -> list[dict]:
    """Return metadata for all known files."""
    meta = _load_meta()
    result = []
    for file_id, info in meta.items():
        result.append({
            "file_id":     file_id,
            "filename":    info.get("filename", "unknown"),
            "row_count":   info.get("row_count", 0),
            "columns":     info.get("columns", []),
            "uploaded_at": info.get("uploaded_at", ""),
            "loaded":      file_id in _registry,
        })
    # newest first
    result.sort(key=lambda x: x["uploaded_at"], reverse=True)
    return result
