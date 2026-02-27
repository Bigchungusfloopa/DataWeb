import api from '../services/api.js';

const SUGGESTIONS = [
  'How many rows are in this dataset?',
  'What is the churn rate?',
  'Show churn by contract type',
  'What is the average monthly charge?',
  'Convert total revenue to INR',
  'What does customer churn mean?',
];

export class ChatPanel {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.isLoading = false;
    this.chartInstances = {};

    // Chat memory state
    this.sessions = {}; // sessionId -> { id, file_id, title, messages: [] }
    this.currentSessionId = null;
    this.file_id = null;

    this.render();
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="chat-layout" style="display:flex; flex-direction:column; height:100%;">
        <div class="chat-header" style="padding:10px 16px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
          <select id="chat-session-select" style="flex:1; max-width:250px; padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-weight:600; font-size:0.85rem;">
            <option value="">-- Start a new chat --</option>
          </select>
          <button id="new-chat-btn" class="clay-btn mint" style="padding:6px 14px; font-size:0.8rem; border-radius:8px; margin-left:10px;">+ New Chat</button>
        </div>
        
        <div class="chat-messages" id="chat-messages" style="flex:1; overflow-y:auto; position:relative;">
          <div class="empty-state" id="chat-empty">
            <div class="empty-icon">💬</div>
            <div class="empty-title">Ask anything about your data</div>
            <div class="empty-sub">Ask for SQL queries, currency conversions, definitions — or anything else.</div>
          </div>
        </div>

        <div class="suggestions" id="suggestions">
          ${SUGGESTIONS.map(s => `
            <button class="suggestion-chip" data-q="${s}">${s}</button>
          `).join('')}
        </div>

        <div class="chat-input-bar">
          <div class="chat-input-wrapper">
            <textarea class="chat-textarea" id="chat-input"
              placeholder="Ask a question, request a conversion, or type anything…"
              rows="1"></textarea>
          </div>
          <button class="send-btn" id="send-btn" title="Send">➤</button>
        </div>
      </div>
    `;
    this._bindEvents();
    this._updateSessionDropdown();
  }

  _bindEvents() {
    const input = this.container.querySelector('#chat-input');
    const sendBtn = this.container.querySelector('#send-btn');
    const newChatBtn = this.container.querySelector('#new-chat-btn');
    const sessionSelect = this.container.querySelector('#chat-session-select');

    sendBtn.addEventListener('click', () => this._sendMessage());

    newChatBtn.addEventListener('click', () => {
      this.currentSessionId = null;
      this._updateSessionDropdown();
      this._renderMessages();
    });

    sessionSelect.addEventListener('change', (e) => {
      this.currentSessionId = e.target.value || null;
      this._renderMessages();
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    this.container.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.q;
        this._sendMessage();
      });
    });
  }

  async _sendMessage() {
    if (this.isLoading) return;
    const input = this.container.querySelector('#chat-input');
    const question = input.value.trim();
    if (!question) return;

    if (!this.file_id) {
      this._appendUserMessage(question);
      this._appendErrorMsg('⚠️ No file selected. Please select a file from the sidebar or upload a new one first.');
      input.value = '';
      return;
    }

    input.value = '';
    input.style.height = 'auto';

    const empty = this.container.querySelector('#chat-empty');
    const suggestions = this.container.querySelector('#suggestions');
    if (empty) empty.style.display = 'none';
    if (suggestions) suggestions.style.display = 'none';

    this._appendUserMessage(question);

    // Ensure session exists locally if we are continuing
    if (this.currentSessionId && !this.sessions[this.currentSessionId]) {
      this.sessions[this.currentSessionId] = { id: this.currentSessionId, file_id: this.file_id, title: question, messages: [] };
    }

    // Optimistic local push
    if (this.currentSessionId) {
      this.sessions[this.currentSessionId].messages.push({ role: 'user', text: question });
    }

    this.isLoading = true;
    this._setLoading(true);

    try {
      const result = await api.query(question, this.file_id, this.currentSessionId);
      this._removeTyping();

      const newSessionId = result.session_id;

      if (!this.sessions[newSessionId]) {
        this.sessions[newSessionId] = {
          id: newSessionId,
          file_id: this.file_id,
          title: question.substring(0, 30) + (question.length > 30 ? '...' : ''),
          messages: []
        };
        // If it was a new chat, push the user message to the new session
        if (!this.currentSessionId) {
          this.sessions[newSessionId].messages.push({ role: 'user', text: question });
        }
      }

      // Update session map
      this.currentSessionId = newSessionId;
      this.sessions[newSessionId].messages.push({ role: 'ai', result: result });

      this._updateSessionDropdown();
      this._appendAIMessage(result);
    } catch (err) {
      this._removeTyping();
      const isOffline = err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('Failed to fetch');
      if (isOffline) {
        this._appendErrorMsg('⚠️ Cannot reach the backend. Make sure `bash start_backend.sh` is running.');
      } else if (err.message.includes('404') || err.message.includes('dataset')) {
        this._appendErrorMsg('⚠️ No dataset loaded yet. Go to Upload CSV and drag your CSV in first.');
      } else {
        this._appendErrorMsg(`⚠️ ${err.message}`);
      }
    } finally {
      this.isLoading = false;
      this._setLoading(false);
    }
  }

  setFileId(file_id) {
    this.file_id = file_id;
    // Auto-switch to the most recent session for this file, or new chat
    const fileSessions = Object.values(this.sessions).filter(s => s.file_id === file_id);
    this.currentSessionId = fileSessions.length > 0 ? fileSessions[fileSessions.length - 1].id : null;

    this._updateSessionDropdown();
    this._renderMessages();
  }

  _updateSessionDropdown() {
    const select = this.container.querySelector('#chat-session-select');
    if (!select) return;

    const fileSessions = Object.values(this.sessions).filter(s => s.file_id === this.file_id);

    if (fileSessions.length === 0) {
      select.innerHTML = '<option value="">-- Start a new chat --</option>';
      select.disabled = true;
      return;
    }

    select.disabled = false;
    let html = '';
    if (!this.currentSessionId) {
      html += '<option value="">-- New Chat --</option>';
    }
    fileSessions.forEach(s => {
      html += `<option value="${s.id}" ${s.id === this.currentSessionId ? 'selected' : ''}>${this._escapeHtml(s.title)}</option>`;
    });
    select.innerHTML = html;
  }

  _renderMessages() {
    const messages = this.container.querySelector('#chat-messages');
    if (!messages) return;

    messages.innerHTML = '';

    if (!this.currentSessionId || !this.sessions[this.currentSessionId] || this.sessions[this.currentSessionId].messages.length === 0) {
      messages.innerHTML = `
          <div class="empty-state" id="chat-empty">
            <div class="empty-icon">💬</div>
            <div class="empty-title">Ask anything about your data</div>
            <div class="empty-sub">Ask for SQL queries, currency conversions, definitions — or anything else.</div>
          </div>
        `;
      const suggestions = this.container.querySelector('#suggestions');
      if (suggestions) suggestions.style.display = 'flex';
      return;
    }

    const suggestions = this.container.querySelector('#suggestions');
    if (suggestions) suggestions.style.display = 'none';

    const session = this.sessions[this.currentSessionId];
    session.messages.forEach(msg => {
      if (msg.role === 'user') {
        this._appendUserMessage(msg.text);
      } else {
        this._appendAIMessage(msg.result);
      }
    });
  }

  _appendUserMessage(text) {
    const messages = this.container.querySelector('#chat-messages');
    const row = document.createElement('div');
    row.className = `msg-row user`;
    row.innerHTML = `
      <div class="msg-avatar">👤</div>
      <div class="msg-bubble">${this._escapeHtml(text)}</div>
    `;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  _appendErrorMsg(text) {
    const messages = this.container.querySelector('#chat-messages');
    const row = document.createElement('div');
    row.className = `msg-row ai`;
    row.innerHTML = `
       <div class="msg-avatar">🤖</div>
       <div class="msg-bubble" style="background:#ffebee; color:#d32f2f;">${this._escapeHtml(text)}</div>
     `;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  _appendAIMessage(result) {
    const messages = this.container.querySelector('#chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-row ai';

    const msgId = `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const chartId = `chart-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const route = result.route || 'sql';

    // Route badge
    const badgeInfo = {
      general: { label: '🧠 General answer', color: '#a1d4ff' },
      compute: { label: '🔢 Compute + SQL', color: '#ffc4a1' },
      sql: { label: '🗄️ SQL query', color: '#c4a1ff' },
    }[route] || { label: '🗄️ SQL query', color: '#c4a1ff' };

    // A chart needs at least two columns and more than 0 rows.
    // We also need to ensure it's not simply returning a "Column not found" error row.
    const isErrorRow = result.rows?.length === 1 && result.columns?.[0] === 'error';
    const hasDataRows = result.rows?.length > 0 && !isErrorRow;

    const hasChart = hasDataRows && result.chart_type && !['none', 'table', 'kpi'].includes(result.chart_type) && result.columns?.length >= 2;
    const isKPI = hasDataRows && result.chart_type === 'kpi';
    const hasTable = hasDataRows && result.chart_type === 'table';

    // KPI card(s)
    let kpiHtml = '';
    if (isKPI && result.rows[0]) {
      kpiHtml = Object.entries(result.rows[0]).map(([key, val]) => {
        const fmt = typeof val === 'number'
          ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2))
          : val;
        return `<div style="margin-top:10px;padding:14px 18px;background:var(--clay-lavender);border-radius:var(--radius-md);box-shadow:4px 4px 0 var(--shadow-lavender);">
                  <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-mid);">${key.replace(/_/g, ' ')}</div>
                  <div style="font-size:2rem;font-weight:900;color:var(--text-dark);line-height:1.1;">${fmt}</div>
                </div>`;
      }).join('');
    }

    // Mini table
    let miniTableHtml = '';
    if (hasTable && result.rows?.length > 0) {
      const cols = result.columns;
      miniTableHtml = `
            <div style="margin-top:10px;border-radius:var(--radius-sm);overflow:hidden;border:2px solid hsl(50,20%,88%);">
              <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
                <thead>
                  <tr style="background:hsl(50,20%,92%);">
                    ${cols.map(c => `<th style="padding:8px 10px;text-align:left;font-weight:800;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-mid);">${c}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${result.rows.slice(0, 10).map(r => `
                    <tr style="border-bottom:1px solid hsl(50,20%,90%);">
                      ${cols.map(c => `<td style="padding:7px 10px;font-weight:600;color:var(--text-dark);">${r[c] ?? '—'}</td>`).join('')}
                    </tr>`).join('')}
                </tbody>
              </table>
              ${result.rows.length > 10 ? `<div style="padding:6px 10px;font-size:0.75rem;color:var(--text-mid);font-weight:700;background:hsl(50,20%,93%);">+${result.rows.length - 10} more rows</div>` : ''}
            </div>`;
    }

    // SQL viewer — hidden for GENERAL (no SQL)
    const sqlHtml = result.sql ? `
            <div class="sql-viewer">
              <button class="sql-toggle" data-target="sql-${msgId}">
                🗂️ &nbsp;View Generated SQL &nbsp;▾
              </button>
              <pre class="sql-code" id="sql-${msgId}">${this._escapeHtml(result.sql)}</pre>
            </div>` : '';

    row.innerHTML = `
          <div class="msg-avatar">🤖</div>
          <div class="msg-bubble" id="${msgId}">
            <div style="font-size:0.68rem;font-weight:800;color:#555;margin-bottom:8px;padding:2px 10px;background:${badgeInfo.color}44;border-radius:999px;display:inline-block;">${badgeInfo.label}</div>
            <div>${this._escapeHtml(result.explanation || 'Here are the results.')}</div>
            ${kpiHtml}
            ${hasChart ? `<div class="chart-container"><canvas id="${chartId}" height="220"></canvas></div>` : ''}
            ${miniTableHtml}
            ${sqlHtml}
          </div>
        `;

    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;

    row.querySelector('.sql-toggle')?.addEventListener('click', function () {
      const code = document.getElementById(this.dataset.target);
      const isVisible = code?.classList.contains('visible');
      if (code) {
        code.classList.toggle('visible');
        this.textContent = code.classList.contains('visible')
          ? '🗂️   Hide SQL   ▴'
          : '🗂️   View Generated SQL   ▾';
      }
    });

    if (hasChart) requestAnimationFrame(() => this._renderChart(chartId, result));
  }

  _renderChart(canvasId, result) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const { rows, columns, chart_type } = result;
    if (!rows || rows.length === 0 || columns.length < 2) return;

    const labels = rows.map(r => String(r[columns[0]]));
    const values = rows.map(r => parseFloat(r[columns[1]]) || 0);

    const palette = ['#c4a1ff', '#a1d4ff', '#ffc4a1', '#a1ffcf', '#ffa1c4', '#fff4a1', '#a1b4ff', '#ffd4a1'];

    const config = {
      type: chart_type === 'line' ? 'line' : 'bar',
      data: {
        labels,
        datasets: [{
          label: columns[1].replace(/_/g, ' '),
          data: values,
          backgroundColor: chart_type === 'line' ? 'rgba(196,161,255,0.25)' : labels.map((_, i) => palette[i % palette.length]),
          borderColor: chart_type === 'line' ? '#b090ee' : labels.map((_, i) => palette[i % palette.length]),
          borderWidth: 3,
          borderRadius: chart_type !== 'line' ? 8 : 0,
          tension: 0.4,
          fill: chart_type === 'line',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y?.toLocaleString()}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Nunito', weight: '700', size: 11 } } },
          y: { grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { font: { family: 'Nunito', weight: '700', size: 11 } } },
        },
      },
    };

    if (this.chartInstances[canvasId]) this.chartInstances[canvasId].destroy();
    this.chartInstances[canvasId] = new Chart(canvas, config);
  }

  _setLoading(loading) {
    const sendBtn = this.container.querySelector('#send-btn');
    if (sendBtn) sendBtn.disabled = loading;
    if (loading) this._addTyping();
  }

  _addTyping() {
    const messages = this.container.querySelector('#chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    row.id = 'typing-row';

    const scaffoldMsgs = [
      'Reading dataset...',
      'Analyzing schema...',
      'Generating SQL context...',
      'Executing query...',
      'Formatting results...',
      'Finalizing...'
    ];

    row.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble clay-card mint" style="padding:14px 18px; display:flex; align-items:center; gap:12px;">
        <div class="typing-indicator" style="padding:0;">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
        <div id="scaffold-text" style="font-size: 0.85rem; font-weight: 700; color: var(--text-mid); transition: opacity 0.3s ease;">${scaffoldMsgs[0]}</div>
      </div>`;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;

    let step = 0;
    this.typingInterval = setInterval(() => {
      step++;
      const el = document.getElementById('scaffold-text');
      if (el && step < scaffoldMsgs.length) {
        el.style.opacity = '0';
        setTimeout(() => {
          if (el) {
            el.innerText = scaffoldMsgs[step];
            el.style.opacity = '1';
          }
        }, 300);
      } else if (step >= scaffoldMsgs.length) {
        clearInterval(this.typingInterval);
      }
    }, 2500);
  }

  _removeTyping() {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    document.getElementById('typing-row')?.remove();
  }

  _escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
