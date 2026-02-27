/**
 * API Service Layer
 * All backend communication goes through here.
 * To connect to real backend: change BASE_URL to your FastAPI server address.
 */

const BASE_URL = 'http://localhost:8000';

// ── Internal helpers ─────────────────────────────────────────────────────────

async function post(path, body, isFormData = false) {
    const opts = {
        method: 'POST',
        body: isFormData ? body : JSON.stringify(body),
    };
    if (!isFormData) opts.headers = { 'Content-Type': 'application/json' };
    const res = await fetch(BASE_URL + path, opts);
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `HTTP ${res.status}`);
    return json;
}

async function get(path) {
    const res = await fetch(BASE_URL + path);
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `HTTP ${res.status}`);
    return json;
}

// ── Public API ───────────────────────────────────────────────────────────────

export const api = {
    // ── DuckDB (in-memory, fast analytics) ──────────────────────────────────
    upload: async (file) => { const fd = new FormData(); fd.append('file', file); return post('/upload', fd, true); },
    getSchema: () => get('/schema'),
    getStats: () => get('/stats'),
    /** DuckDB NL query → SQL → results + explanation + chart_type */
    query: (question) => post('/query', { question }),

    // ── PostgreSQL (persistent storage) ─────────────────────────────────────
    /** Upload CSV to a named PostgreSQL table */
    pgUpload: async (file) => { const fd = new FormData(); fd.append('file', file); return post('/pg/upload', fd, true); },
    /** List all user tables in the PostgreSQL database */
    pgTables: () => get('/pg/tables'),
    /** Schema + sample for a specific PG table */
    pgSchema: (table) => get(`/pg/schema/${table}`),
    /** Aggregate stats for a PG table */
    pgStats: (table) => get(`/pg/stats/${table}`),
    /** NL query against a specific PostgreSQL table */
    pgQuery: (question, table_name) => post('/pg/query', { question, table_name }),
    /** PostgreSQL connection health */
    pgHealth: () => get('/pg/health'),

    // ── JSON Data Layer (no LLM — direct from dataset cache) ────────────────
    /** Full dataset as JSON (up to 5000 rows) */
    getData: (limit = 5000) => get(`/data?limit=${limit}`),
    /** First N rows */
    getSample: (n = 20) => get(`/data/sample?n=${n}`),
    /** Column names + types */
    getColumns: () => get('/data/columns'),
    /** All values for one column — array */
    getColumnValues: (col) => get(`/data/column/${col}`),
    /** value → count map — perfect for bar/pie charts */
    getValueCounts: (col) => get(`/data/counts/${col}`),

    // ── Combined health (Ollama + DuckDB + PostgreSQL) ───────────────────────
    health: () => get('/health'),
};

export default api;
