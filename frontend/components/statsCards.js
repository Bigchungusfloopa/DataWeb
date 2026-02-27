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
export async function renderCategoricalCharts(stats, containerElement) {
  if (!containerElement || !stats?.categorical_stats) return;

  const fileId = stats.file_id; // Added to the stats payload earlier
  containerElement.innerHTML = '';
  const cols = Object.keys(stats.categorical_stats);
  if (cols.length === 0) return;

  for (let i = 0; i < Math.min(cols.length, 2); i++) {
    const col = cols[i];
    const wrapper = document.createElement('div');
    wrapper.className = 'clay-card mt-6';
    wrapper.style.padding = '24px';
    wrapper.style.flex = '1';
    wrapper.style.minWidth = '280px';
    wrapper.innerHTML = `
      <div class="view-subtitle" style="margin-bottom:16px;">Distribution of ${col.replace(/_/g, ' ')}</div>
      <div style="position:relative; height:220px; width:100%;">
        <canvas id="chart-${col}"></canvas>
      </div>`;
    containerElement.appendChild(wrapper);

    try {
      // Fetch real full counts from JSON data layer instead of the 5-item DB limit
      const countData = await api.getValueCounts(fileId, col);

      const ctx = document.getElementById(`chart-${col}`);
      const palette = ['#c4a1ff', '#a1d4ff', '#ffc4a1', '#a1ffcf', '#ffa1c4'];

      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: countData.labels,
          datasets: [{
            data: countData.values,
            backgroundColor: palette,
            borderWidth: 0,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: { position: 'right', labels: { font: { family: 'Nunito', weight: '700' }, color: '#666' } }
          }
        }
      });
    } catch (e) {
      console.error(`Error rendering chart for ${col}:`, e);
    }
  }
}
