/**
 * API Service Layer — all backend communication.
 * All DuckDB calls require a file_id to scope to the correct dataset.
 */

const BASE_URL = 'http://localhost:8000';

// ── Internal helpers ─────────────────────────────────────────────────────────

async function post(path, body, isFormData = false) {
    const opts = { method: 'POST', body: isFormData ? body : JSON.stringify(body) };
    if (!isFormData) opts.headers = { 'Content-Type': 'application/json' };
    const res = await fetch(BASE_URL + path, opts);
    const json = await res.json();
    if (res.status === 422 && json.explanation) return json;   // SQL error with explanation
    if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
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
    // ── File management ──────────────────────────────────────────────────────
    /** Upload a CSV — returns { file_id, schema, message } */
    upload: async (file) => {
        const fd = new FormData();
        fd.append('file', file);
        return post('/upload', fd, true);
    },
    /** List all uploaded files */
    listFiles: () => get('/files'),
    /** Delete a file by id */
    deleteFile: (file_id) => fetch(`${BASE_URL}/files/${file_id}`, { method: 'DELETE' }).then(r => r.json()),
    /** Schema for a specific file */
    getSchema: (file_id) => get(`/schema?file_id=${file_id}`),
    /** Aggregate stats for a file */
    getStats: (file_id) => get(`/stats?file_id=${file_id}`),

    // ── NL Query & Sessions (scoped to file_id) ──────────────────────────────
    /** NL question → SQL → results + explanation + chart_type */
    query: (question, file_id, session_id) => post('/query', { question, file_id, session_id }),
    /** Fetch historic chat sessions */
    getSessions: (file_id) => get(`/sessions?file_id=${file_id}`),
    /** Delete a chat session */
    deleteSession: (session_id) => fetch(`${BASE_URL}/sessions/${session_id}`, { method: 'DELETE' }).then(r => r.json()),

    // ── JSON Data Layer ───────────────────────────────────────────────────────
    getData: (file_id, limit = 5000) => get(`/data?file_id=${file_id}&limit=${limit}`),
    getSample: (file_id, n = 20) => get(`/data/sample?file_id=${file_id}&n=${n}`),
    getColumns: (file_id) => get(`/data/columns?file_id=${file_id}`),
    getColumnValues: (file_id, col) => get(`/data/column/${col}?file_id=${file_id}`),
    getValueCounts: (file_id, col) => get(`/data/counts/${col}?file_id=${file_id}`),

    // ── PostgreSQL ────────────────────────────────────────────────────────────
    pgUpload: async (file) => { const fd = new FormData(); fd.append('file', file); return post('/pg/upload', fd, true); },
    pgTables: () => get('/pg/tables'),
    pgSchema: (table) => get(`/pg/schema/${table}`),
    pgStats: (table) => get(`/pg/stats/${table}`),
    pgQuery: (question, table_name) => post('/pg/query', { question, table_name }),
    pgHealth: () => get('/pg/health'),

    // ── Health ────────────────────────────────────────────────────────────────
    health: () => get('/health'),
};

export default api;
