/**
 * Data Table component — paginated, searchable clay-styled table
 */

const PAGE_SIZE = 20;

export class DataTable {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.rows = [];
        this.columns = [];
        this.page = 1;
        this.filter = '';
    }

    setData(columns, rows) {
        this.columns = columns;
        this.rows = rows;
        this.page = 1;
        this.render();
    }

    get filteredRows() {
        if (!this.filter) return this.rows;
        const f = this.filter.toLowerCase();
        return this.rows.filter(row =>
            Object.values(row).some(v => String(v).toLowerCase().includes(f))
        );
    }

    render() {
        if (!this.container) return;
        const filtered = this.filteredRows;
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        this.page = Math.min(this.page, totalPages);
        const start = (this.page - 1) * PAGE_SIZE;
        const pageRows = filtered.slice(start, start + PAGE_SIZE);

        if (this.columns.length === 0) {
            this.container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <div class="empty-title">No data loaded</div>
          <div class="empty-sub">Upload a CSV file to explore your data here.</div>
        </div>`;
            return;
        }

        this.container.innerHTML = `
      <div style="display:flex; gap:10px; margin-bottom:14px; align-items:center;">
        <input class="clay-input" id="table-search" type="text"
               placeholder="🔍  Search rows…" value="${this.filter}"
               style="max-width:320px;">
        <span style="font-size:0.8rem; font-weight:700; color:var(--text-light); white-space:nowrap;">
          ${filtered.length.toLocaleString()} rows
        </span>
      </div>

      <div class="clay-card" style="padding:0; overflow:hidden;">
        <div class="table-wrapper">
          <table class="clay-table">
            <thead>
              <tr>
                ${this.columns.map(c => `<th>${c}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${pageRows.length === 0
                ? `<tr><td colspan="${this.columns.length}" style="text-align:center;padding:24px;color:var(--text-mid);">No results found</td></tr>`
                : pageRows.map(row => `
                  <tr>
                    ${this.columns.map(c => `<td>${this.formatCell(c, row[c])}</td>`).join('')}
                  </tr>`).join('')
            }
            </tbody>
          </table>
        </div>
      </div>

      <div class="pagination">
        <button class="clay-btn secondary" id="prev-page" ${this.page <= 1 ? 'disabled' : ''} style="padding:7px 14px; font-size:0.8rem;">‹ Prev</button>
        <span class="page-info">Page ${this.page} of ${totalPages}</span>
        <button class="clay-btn secondary" id="next-page" ${this.page >= totalPages ? 'disabled' : ''} style="padding:7px 14px; font-size:0.8rem;">Next ›</button>
      </div>
    `;

        this.container.querySelector('#table-search')?.addEventListener('input', e => {
            this.filter = e.target.value;
            this.page = 1;
            this.render();
        });
        this.container.querySelector('#prev-page')?.addEventListener('click', () => { this.page--; this.render(); });
        this.container.querySelector('#next-page')?.addEventListener('click', () => { this.page++; this.render(); });
    }

    formatCell(col, val) {
        if (val == null || val === '') return '<span style="color:var(--text-light)">—</span>';
        const s = String(val);
        if (s.toLowerCase() === 'yes') return `<span class="table-pill pill-yes">Yes</span>`;
        if (s.toLowerCase() === 'no') return `<span class="table-pill pill-no">No</span>`;
        return s.length > 30 ? `<span title="${s}">${s.slice(0, 30)}…</span>` : s;
    }
}
