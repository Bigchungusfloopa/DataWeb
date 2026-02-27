/**
 * Sidebar component — clay pill navigation with dual-DB status
 */
export function renderSidebar(activeView, onNavigate, statusInfo) {
  const nav = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'chat', icon: '💬', label: 'Ask AI' },
    { id: 'explorer', icon: '🔍', label: 'Data Explorer' },
    { id: 'upload', icon: '📂', label: 'Upload CSV' },
  ];

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const ollamaOk = statusInfo?.ollama === 'connected';
  const pgOk = statusInfo?.postgresql?.connected;
  const duckDb = statusInfo?.duckdb || {};
  const pgTables = statusInfo?.postgresql?.tables || [];

  const duckLabel = duckDb.dataset_loaded
    ? `${duckDb.table} · ${(duckDb.rows || 0).toLocaleString()} rows`
    : 'No dataset loaded';

  const pgTableChips = pgTables.length
    ? pgTables.map(t => `<span style="display:inline-block;padding:2px 7px;background:rgba(255,255,255,0.12);border-radius:999px;font-size:0.68rem;font-weight:700;margin:2px;">${t}</span>`).join('')
    : '<span style="font-size:0.7rem;opacity:0.4;">No tables yet</span>';

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <span class="logo-icon">🧠</span>
      <div>
        <div class="logo-text">DataChat</div>
        <div class="logo-sub">AI Data Platform</div>
      </div>
    </div>

    <div class="section-label">Navigation</div>
    <nav class="sidebar-nav">
      ${nav.map(item => `
        <button class="clay-pill ${item.id === activeView ? 'active' : ''}"
                data-view="${item.id}">
          <span class="pill-icon">${item.icon}</span>
          ${item.label}
        </button>
      `).join('')}
    </nav>

    <div class="sidebar-footer">
      <div class="section-label">Status</div>

      <!-- Ollama -->
      <div class="status-badge">
        <span class="status-dot ${ollamaOk ? 'online' : ''}"></span>
        <span>llama3.1:8b ${ollamaOk ? '✓ Ready' : 'Offline'}</span>
      </div>

      <!-- DuckDB -->
      <div class="status-badge" style="margin-top:5px;">
        <span style="font-size:0.9rem;">🦆</span>
        <span style="font-size:0.71rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${duckLabel}</span>
      </div>

      <!-- PostgreSQL -->
      <div class="status-badge" style="margin-top:5px;flex-direction:column;align-items:flex-start;gap:4px;">
        <div style="display:flex;align-items:center;gap:6px;width:100%;">
          <span class="status-dot ${pgOk ? 'online' : ''}"></span>
          <span>PostgreSQL ${pgOk ? '✓' : 'Offline'}</span>
        </div>
        ${pgOk ? `<div style="padding-left:14px;flex-wrap:wrap;display:flex;">${pgTableChips}</div>` : ''}
      </div>
    </div>
  `;

  sidebar.querySelectorAll('.clay-pill[data-view]').forEach(btn => {
    btn.addEventListener('click', () => onNavigate(btn.dataset.view));
  });
}
