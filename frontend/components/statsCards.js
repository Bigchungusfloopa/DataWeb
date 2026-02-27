/**
 * Stats Cards component — KPI clay cards for the dashboard view
 */

export function renderStatsCards(stats, container) {
    if (!container) return;

    if (!stats) {
        container.innerHTML = `
      <div class="stats-grid">
        ${['', '', '', ''].map(() => `
          <div class="clay-card stat-card">
            <div class="skeleton" style="height:28px; width:80%; margin-bottom:8px;"></div>
            <div class="skeleton" style="height:40px; width:60%;"></div>
          </div>
        `).join('')}
      </div>`;
        return;
    }

    const kpis = buildKPIs(stats);

    container.innerHTML = `
    <div class="stats-grid stagger-in">
      ${kpis.map((k, i) => `
        <div class="clay-card stat-card ${k.color}">
          <div class="stat-icon">${k.icon}</div>
          <div class="stat-label">${k.label}</div>
          <div class="stat-value animate">${k.value}</div>
          ${k.sub ? `<div class="stat-sub">${k.sub}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function buildKPIs(stats) {
    const kpis = [
        {
            icon: '📋',
            label: 'Total Rows',
            value: stats.row_count?.toLocaleString() ?? '—',
            sub: `${stats.column_count} columns`,
            color: 'sky',
        },
        {
            icon: '📐',
            label: 'Columns',
            value: stats.column_count ?? '—',
            sub: stats.table_name ?? '',
            color: 'mint',
        },
    ];

    // Add first 2 numeric stats
    const numeric = Object.entries(stats.numeric_stats || {}).slice(0, 2);
    const colors = ['peach', 'yellow', 'rose', 'lavender'];
    numeric.forEach(([col, s], i) => {
        kpis.push({
            icon: '📈',
            label: col.replace(/_/g, ' '),
            value: s.avg != null ? formatNum(s.avg) : '—',
            sub: `min ${formatNum(s.min)} · max ${formatNum(s.max)}`,
            color: colors[i] || '',
        });
    });

    // Add first categorical distribution as churn-style KPI
    const cats = Object.entries(stats.categorical_stats || {});
    if (cats.length > 0) {
        const [col, values] = cats[0];
        const top = values[0];
        kpis.push({
            icon: '🏷️',
            label: `Top ${col.replace(/_/g, ' ')}`,
            value: top?.value ?? '—',
            sub: `${top?.count?.toLocaleString()} records`,
            color: 'rose',
        });
    }

    return kpis;
}

function formatNum(n) {
    if (n == null) return '—';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Renders bar charts for categorical columns.
 */
export function renderCategoricalCharts(stats, container) {
    if (!container || !stats?.categorical_stats) return;

    const entries = Object.entries(stats.categorical_stats);
    if (entries.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
      ${entries.map(([col, values]) => `
        <div class="clay-card" style="padding: 18px;">
          <div class="stat-label" style="margin-bottom:12px;">${col.replace(/_/g, ' ')} distribution</div>
          ${values.map(v => {
        const max = values[0]?.count || 1;
        const pct = Math.round((v.count / max) * 100);
        return `
              <div style="margin-bottom: 8px;">
                <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:700; color:var(--text-mid); margin-bottom:3px;">
                  <span>${v.value ?? 'N/A'}</span>
                  <span>${v.count?.toLocaleString()}</span>
                </div>
                <div style="height: 8px; background: hsl(50,20%,88%); border-radius:999px; overflow:hidden;">
                  <div style="height:100%; width:${pct}%; background: var(--shadow-lavender); border-radius:999px; transition: width 0.8s ease;"></div>
                </div>
              </div>
            `;
    }).join('')}
        </div>
      `).join('')}
    </div>
  `;
}
