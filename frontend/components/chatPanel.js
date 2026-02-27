/**
 * Chat Panel component — AI chat interface with SQL viewer + Chart.js visualization
 */
import api from '../services/api.js';

const SUGGESTIONS = [
    'How many rows are in this dataset?',
    'What is the churn rate?',
    'Show churn by contract type',
    'What is the average monthly charge?',
    'Show top 5 payment methods',
    'How many senior citizens are there?',
];

export class ChatPanel {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.messages = [];
        this.isLoading = false;
        this.chartInstances = {};
        this.render();
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = `
      <div class="chat-layout">
        <div class="chat-messages" id="chat-messages">
          <div class="empty-state" id="chat-empty">
            <div class="empty-icon">💬</div>
            <div class="empty-title">Ask anything about your data</div>
            <div class="empty-sub">Upload a CSV and start chatting. The AI will query your data and explain results.</div>
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
              placeholder="Ask a question about your data…"
              rows="1"></textarea>
          </div>
          <button class="send-btn" id="send-btn" title="Send">➤</button>
        </div>
      </div>
    `;

        this._bindEvents();
    }

    _bindEvents() {
        const input = this.container.querySelector('#chat-input');
        const sendBtn = this.container.querySelector('#send-btn');

        sendBtn.addEventListener('click', () => this._sendMessage());

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._sendMessage();
            }
        });

        // Auto-resize textarea
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        // Suggestion chips
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

        input.value = '';
        input.style.height = 'auto';

        // Hide empty state & suggestions
        const empty = this.container.querySelector('#chat-empty');
        if (empty) empty.style.display = 'none';
        const suggestions = this.container.querySelector('#suggestions');
        if (suggestions) suggestions.style.display = 'none';

        // Add user message
        this._addMessage('user', question);

        // Show typing indicator
        this.isLoading = true;
        this._setLoading(true);

        try {
            const result = await api.query(question);
            this._removeTyping();
            this._addAIMessage(result);
        } catch (err) {
            this._removeTyping();
            this._addMessage('ai', `⚠️ Error: ${err.message}. Make sure the backend is running and a CSV is loaded.`);
        } finally {
            this.isLoading = false;
            this._setLoading(false);
        }
    }

    _addMessage(role, text) {
        const messages = this.container.querySelector('#chat-messages');
        const row = document.createElement('div');
        row.className = `msg-row ${role}`;

        const avatar = role === 'user' ? '👤' : '🤖';
        row.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-bubble">${this._escapeHtml(text)}</div>
    `;
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
    }

    _addAIMessage(result) {
        const messages = this.container.querySelector('#chat-messages');
        const row = document.createElement('div');
        row.className = 'msg-row ai';

        const msgId = `msg-${Date.now()}`;
        const chartId = `chart-${Date.now()}`;
        const hasChart = result.chart_type && result.chart_type !== 'none' && result.chart_type !== 'table' && result.chart_type !== 'kpi' && result.rows?.length > 0;
        const isKPI = result.chart_type === 'kpi' && result.rows?.length === 1;
        const hasTable = result.chart_type === 'table' && result.rows?.length > 0;

        let kpiHtml = '';
        if (isKPI && result.rows[0]) {
            const [key, val] = Object.entries(result.rows[0])[0];
            const formatted = typeof val === 'number' ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2)) : val;
            kpiHtml = `
        <div style="margin-top:10px; padding:14px 18px; background:var(--clay-lavender); border-radius:var(--radius-md); box-shadow:4px 4px 0 var(--shadow-lavender);">
          <div style="font-size:0.7rem; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:var(--text-mid);">${key.replace(/_/g, ' ')}</div>
          <div style="font-size:2rem; font-weight:900; color:var(--text-dark); line-height:1.1;">${formatted}</div>
        </div>`;
        }

        let miniTableHtml = '';
        if (hasTable && result.rows?.length > 0) {
            const cols = result.columns;
            miniTableHtml = `
        <div style="margin-top:10px; border-radius:var(--radius-sm); overflow:hidden; border:2px solid hsl(50,20%,88%);">
          <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
            <thead>
              <tr style="background:hsl(50,20%,92%);">
                ${cols.map(c => `<th style="padding:8px 10px; text-align:left; font-weight:800; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-mid);">${c}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${result.rows.slice(0, 10).map(row => `
                <tr style="border-bottom: 1px solid hsl(50,20%,90%);">
                  ${cols.map(c => `<td style="padding:7px 10px; font-weight:600; color:var(--text-dark);">${row[c] ?? '—'}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
          ${result.rows.length > 10 ? `<div style="padding:6px 10px; font-size:0.75rem; color:var(--text-mid); font-weight:700; background:hsl(50,20%,93%);">+${result.rows.length - 10} more rows</div>` : ''}
        </div>`;
        }

        row.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble" id="${msgId}">
        <div>${this._escapeHtml(result.explanation || 'Here are the results.')}</div>

        ${kpiHtml}
        ${hasChart ? `<div class="chart-container"><canvas id="${chartId}" height="220"></canvas></div>` : ''}
        ${miniTableHtml}

        <div class="sql-viewer">
          <button class="sql-toggle" data-target="sql-${msgId}">
            🗂️ &nbsp;View Generated SQL &nbsp;▾
          </button>
          <pre class="sql-code" id="sql-${msgId}">${this._escapeHtml(result.sql || '')}</pre>
        </div>
      </div>
    `;

        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;

        // SQL toggle
        row.querySelector('.sql-toggle')?.addEventListener('click', function () {
            const code = document.getElementById(this.dataset.target);
            code?.classList.toggle('visible');
            this.textContent = code?.classList.contains('visible')
                ? '🗂️   Hide SQL   ▴'
                : '🗂️   View Generated SQL   ▾';
        });

        // Render chart
        if (hasChart) {
            requestAnimationFrame(() => this._renderChart(chartId, result));
        }
    }

    _renderChart(canvasId, result) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const { rows, columns, chart_type } = result;
        if (!rows || rows.length === 0 || columns.length < 2) return;

        const labels = rows.map(r => String(r[columns[0]]));
        const values = rows.map(r => parseFloat(r[columns[1]]) || 0);

        const palette = [
            '#c4a1ff', '#a1d4ff', '#ffc4a1', '#a1ffcf', '#ffa1c4', '#fff4a1',
            '#a1b4ff', '#ffd4a1',
        ];

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

        // Destroy existing instance if re-using
        if (this.chartInstances[canvasId]) this.chartInstances[canvasId].destroy();
        this.chartInstances[canvasId] = new Chart(canvas, config);
    }

    _setLoading(loading) {
        const sendBtn = this.container.querySelector('#send-btn');
        if (sendBtn) sendBtn.disabled = loading;
    }

    _addTyping() {
        const messages = this.container.querySelector('#chat-messages');
        const row = document.createElement('div');
        row.className = 'msg-row ai';
        row.id = 'typing-row';
        row.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble clay-card mint" style="padding:14px 18px;">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>`;
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
    }

    _removeTyping() {
        document.getElementById('typing-row')?.remove();
    }

    _setLoading(loading) {
        const sendBtn = this.container.querySelector('#send-btn');
        if (sendBtn) sendBtn.disabled = loading;
        if (loading) this._addTyping();
    }

    _escapeHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
