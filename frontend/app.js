/**
 * App.js — Main application router and state manager
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
    schema: null,
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

    // Poll health status every 5s
    await refreshHealth();
    setInterval(refreshHealth, 5000);
}

// ── Navigation ───────────────────────────────────────────────────────────────
function navigateTo(viewId) {
    state.currentView = viewId;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.add('active');

    renderSidebar(viewId, navigateTo, state.health);

    if (viewId === 'dashboard') loadDashboard();
    if (viewId === 'explorer') loadExplorer();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
    const statsContainer = document.getElementById('stats-container');
    const chartContainer = document.getElementById('chart-container');

    if (!state.schema) {
        if (statsContainer) statsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-title">No dataset loaded</div>
        <div class="empty-sub">Upload a CSV file to see your data insights here.</div>
        <button class="clay-btn primary" onclick="window.app.navigateTo('upload')" style="margin-top:12px;">Upload CSV →</button>
      </div>`;
        return;
    }

    renderStatsCards(null, statsContainer); // show skeleton
    try {
        if (!state.stats) state.stats = await api.getStats();
        renderStatsCards(state.stats, statsContainer);
        renderCategoricalCharts(state.stats, chartContainer);
    } catch (err) {
        if (statsContainer) statsContainer.innerHTML = `<p style="color:var(--clay-rose);font-weight:700;">Error loading stats: ${err.message}</p>`;
    }
}

// ── Explorer ──────────────────────────────────────────────────────────────────
async function loadExplorer() {
    if (state.tableRows.length === 0 && state.schema) {
        // Load sample from schema
        state.tableRows = state.schema.sample || [];
        state.tableColumns = state.schema.columns?.map(c => c.name) || [];
    }
    dataTable.setData(state.tableColumns, state.tableRows);
}

// ── Upload success callback ───────────────────────────────────────────────────
async function onUploadSuccess(schema, parsedCSV) {
    state.schema = schema;
    state.stats = null; // reset stats cache

    // Load table data from client-side parsed CSV for instant display
    if (parsedCSV) {
        state.tableColumns = parsedCSV.columns;
        state.tableRows = parsedCSV.rows;
    }

    showToast(`✅ Loaded ${schema.row_count?.toLocaleString()} rows!`, 'success');

    // Navigate to dashboard after short delay
    setTimeout(() => navigateTo('dashboard'), 1200);
}

// ── Health check ──────────────────────────────────────────────────────────────
async function refreshHealth() {
    try {
        state.health = await api.health();
        if (state.health.dataset_loaded && !state.schema) {
            state.schema = { table_name: state.health.table, row_count: state.health.rows };
        }
    } catch {
        state.health = { ollama: 'offline', dataset_loaded: false };
    }
    renderSidebar(state.currentView, navigateTo, state.health);
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
window.app = { navigateTo, showToast };

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
