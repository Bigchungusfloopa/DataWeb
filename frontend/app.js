/**
 * App.js — Main application router and state manager
 * Now supports multiple files: each upload gets a file_id, state.activeFileId tracks the active one.
 */
import { renderSidebar } from './components/sidebar.js';
import { renderStatsCards, renderCategoricalCharts } from './components/statsCards.js';
import { DataTable } from './components/dataTable.js';
import { UploadPanel } from './components/uploadPanel.js';
import { ChatPanel } from './components/chatPanel.js';
import api from './services/api.js';

// ── App State ────────────────────────────────────────────────────────────────
const state = {
    currentView: 'upload',
    activeFileId: null,      // UUID of the currently selected file
    files: [],        // all uploaded files from /files
    schema: null,      // schema of the active file
    stats: null,
    health: null,
    tableRows: [],
    tableColumns: [],
};

// ── Component instances ──────────────────────────────────────────────────────
let dataTable = null;
let chatPanel = null;
let uploadPanel = null;

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    navigateTo('upload');
    dataTable = new DataTable('explorer-table');
    chatPanel = new ChatPanel('chat-view-content');
    uploadPanel = new UploadPanel('upload-view-content', onUploadSuccess);

    await refreshHealth();
    await loadFileList();   // load any previously uploaded files
    setInterval(refreshHealth, 8000);
}

// ── File list ─────────────────────────────────────────────────────────────────
async function loadFileList() {
    try {
        state.files = await api.listFiles();
        // Auto-select the most recently uploaded file if none active
        if (!state.activeFileId && state.files.length > 0) {
            await selectFile(state.files[0].file_id);
        }
    } catch { /* server may not have any files yet */ }
    renderSidebar(state.currentView, navigateTo, state.health, state.files, state.activeFileId, selectFile);
}

// ── Select active file ────────────────────────────────────────────────────────
async function selectFile(file_id) {
    if (state.activeFileId === file_id) return;
    state.activeFileId = file_id;
    state.schema = null;
    state.stats = null;
    state.tableRows = [];
    state.tableColumns = [];

    try {
        state.schema = await api.getSchema(file_id);
    } catch { /* file may not be loaded in memory yet */ }

    renderSidebar(state.currentView, navigateTo, state.health, state.files, state.activeFileId, selectFile);

    // Refresh active view
    if (state.currentView === 'dashboard') loadDashboard();
    if (state.currentView === 'explorer') loadExplorer();
    if (chatPanel) chatPanel.setFileId(file_id);

    const activeFile = state.files.find(f => f.file_id === file_id);
    showToast(`Switched to "${activeFile?.filename || file_id}"`, 'info');
}

// ── Delete File ───────────────────────────────────────────────────────────────
async function handleDeleteFile(file_id, event) {
    if (event) event.stopPropagation();

    // Optimistic UI update
    const fileIndex = state.files.findIndex(f => f.file_id === file_id);
    const filename = fileIndex > -1 ? state.files[fileIndex].filename : 'File';

    try {
        await api.deleteFile(file_id);
        showToast(`Deleted "${filename}"`, 'info');

        // Remove from list
        state.files = state.files.filter(f => f.file_id !== file_id);

        if (state.activeFileId === file_id) {
            state.activeFileId = null;
            state.schema = null;
            state.stats = null;
            state.tableRows = [];
            state.tableColumns = [];
            if (chatPanel) chatPanel.setFileId(null);

            // Re-select if another file exists
            if (state.files.length > 0) {
                await selectFile(state.files[0].file_id);
            } else {
                navigateTo('upload');
            }
        }

        renderSidebar(state.currentView, navigateTo, state.health, state.files, state.activeFileId, selectFile);

        // Refresh active view
        if (state.currentView === 'dashboard') loadDashboard();
        if (state.currentView === 'explorer') loadExplorer();
    } catch (err) {
        showToast(`Failed to delete file: ${err.message}`, 'error');
    }
}

// ── Navigation ───────────────────────────────────────────────────────────────
function navigateTo(viewId) {
    state.currentView = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');
    renderSidebar(state.currentView, navigateTo, state.health, state.files, state.activeFileId, selectFile);
    if (viewId === 'dashboard') loadDashboard();
    if (viewId === 'explorer') loadExplorer();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
    const statsContainer = document.getElementById('stats-container');
    const chartContainer = document.getElementById('chart-container');

    if (!state.activeFileId || !state.schema) {
        if (statsContainer) statsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="ph ph-chart-bar"></i></div>
        <div class="empty-title">No file selected</div>
        <div class="empty-sub">Upload a CSV or select one from the sidebar.</div>
        <button class="clay-btn primary" onclick="window.app.navigateTo('upload')" style="margin-top:12px;">Upload CSV &rarr;</button>
      </div>`;
        return;
    }

    renderStatsCards(null, statsContainer);
    try {
        if (!state.stats) state.stats = await api.getStats(state.activeFileId);
        renderStatsCards(state.stats, statsContainer);
        renderCategoricalCharts(state.stats, chartContainer);
    } catch (err) {
        if (statsContainer) statsContainer.innerHTML = `<p style="color:var(--clay-rose);font-weight:700;">Error loading stats: ${err.message}</p>`;
    }
}

// ── Explorer ──────────────────────────────────────────────────────────────────
async function loadExplorer() {
    if (state.tableRows.length === 0 && state.schema) {
        state.tableRows = state.schema.sample || [];
        state.tableColumns = state.schema.columns?.map(c => c.name) || [];
    }
    dataTable.setData(state.tableColumns, state.tableRows);
}

// ── Upload success ────────────────────────────────────────────────────────────
async function onUploadSuccess(schema, parsedCSV, file_id) {
    // Reload file list and activate the new file
    state.files = await api.listFiles();
    await selectFile(file_id);
    state.schema = schema;

    if (parsedCSV) {
        state.tableColumns = parsedCSV.columns;
        state.tableRows = parsedCSV.rows;
    }
    showToast(`Loaded "${schema.filename}" — ${schema.row_count?.toLocaleString()} rows`, 'success');
    setTimeout(() => navigateTo('dashboard'), 1200);
}

// ── Health check ──────────────────────────────────────────────────────────────
async function refreshHealth() {
    try {
        state.health = await api.health();
    } catch {
        state.health = { ollama: 'offline', duckdb: { files_loaded: 0 } };
    }
    renderSidebar(state.currentView, navigateTo, state.health, state.files, state.activeFileId, selectFile);
}

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// ── Expose for HTML onclick handlers ─────────────────────────────────────────
window.app = { navigateTo, showToast, selectFile, handleDeleteFile };

document.addEventListener('DOMContentLoaded', init);
