/**
 * Sidebar component — clay pill navigation with dual-DB status
 */
export function renderSidebar(activeView, onNavigate, statusInfo, files = [], activeFileId = null, selectFile = null) {
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
  const pgTables = statusInfo?.postgresql?.tables || [];

  const pgTableChips = pgTables.length
    ? pgTables.map(t => `<span style="display:inline-block;padding:2px 7px;background:rgba(255,255,255,0.12);border-radius:999px;font-size:0.68rem;font-weight:700;margin:2px;">${t}</span>`).join('')
    : '<span style="font-size:0.7rem;opacity:0.4;">No tables yet</span>';

  // Files list HTML
  let filesHtml = '<div style="font-size:0.75rem; color:var(--text-mid); padding:10px;">No files uploaded</div>';
  if (files && files.length > 0) {
    filesHtml = files.map(f => `
          <div class="sidebar-file-item ${f.file_id === activeFileId ? 'active' : ''}" data-file-id="${f.file_id}">
            <div class="file-icon">📄</div>
            <div class="file-info" style="overflow:hidden; white-space:nowrap;">
              <div class="file-name" style="font-size:0.8rem; font-weight:${f.file_id === activeFileId ? '800' : '600'}; color:${f.file_id === activeFileId ? 'var(--text-dark)' : 'var(--text-mid)'}; text-overflow:ellipsis; overflow:hidden;">${f.filename}</div>
              <div class="file-rows" style="font-size:0.65rem; color:var(--text-light);">${(f.row_count || 0).toLocaleString()} rows</div>
            </div>
          </div>
      `).join('');
  }

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

    <div class="section-label" style="margin-top:20px;">My Files</div>
    <div class="sidebar-files-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:15px; padding:0 12px; max-height: 200px; overflow-y: auto;">
      ${filesHtml}
      <button class="clay-btn default" style="font-size:0.75rem; padding:6px 10px; margin-top:8px; width:100%;" onclick="window.app.navigateTo('upload')">+ Upload New</button>
    </div>

    <div class="sidebar-footer">
      <div class="section-label">Status</div>

      <!-- Ollama -->
      <div class="status-badge">
        <span class="status-dot ${ollamaOk ? 'online' : ''}"></span>
        <span>llama3.1:8b ${ollamaOk ? '✓ Ready' : 'Offline'}</span>
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

  sidebar.querySelectorAll('.sidebar-file-item').forEach(el => {
    el.addEventListener('click', () => {
      if (selectFile) selectFile(el.dataset.fileId);
    });
  });
}
