/**
 * Upload Panel component — drag-and-drop CSV upload with schema preview
 */
import { readCSVFile, detectColumnType } from '../services/csvParser.js';
import api from '../services/api.js';

export class UploadPanel {
  constructor(containerId, onUploadSuccess) {
    this.container = document.getElementById(containerId);
    this.onUploadSuccess = onUploadSuccess;
    this.uploading = false;
    this.render();
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="upload-zone" id="drop-zone">
        <div class="upload-icon">📂</div>
        <div class="upload-title">Drop your CSV file here</div>
        <div class="upload-sub">or click to browse — any structured CSV works</div>
        <input type="file" id="file-input" accept=".csv" style="display:none;">
      </div>

      <div id="schema-preview" style="margin-top: 20px;"></div>
      <div id="upload-status" style="margin-top: 12px; font-size:0.85rem; font-weight:700; color:var(--text-light); text-align:center;"></div>
    `;

    const zone = this.container.querySelector('#drop-zone');
    const input = this.container.querySelector('#file-input');

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', e => { if (e.target.files[0]) this.handleFile(e.target.files[0]); });

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) this.handleFile(f);
    });
  }

  async handleFile(file) {
    if (this.uploading) return;
    if (!file.name.endsWith('.csv')) {
      this.setStatus('❌ Only CSV files are supported.', 'error');
      return;
    }

    this.setStatus('⏳ Reading file…', 'info');
    try {
      const parsed = await readCSVFile(file);
      this.showSchemaPreview(parsed, file);
      await this.uploadToBackend(file, parsed);
    } catch (err) {
      this.setStatus(`❌ ${err.message}`, 'error');
    }
  }

  showSchemaPreview(parsed, file) {
    const preview = this.container.querySelector('#schema-preview');
    if (!preview) return;

    const typeColors = { numeric: 'peach', categorical: 'mint', text: 'sky' };

    preview.innerHTML = `
      <div class="clay-card" style="padding: 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div>
            <div style="font-size:0.85rem; font-weight:800; color:var(--text-dark);">📄 ${file.name}</div>
            <div style="font-size:0.75rem; color:var(--text-mid); font-weight:600;">
              ${parsed.rowCount.toLocaleString()} rows · ${parsed.columns.length} columns
            </div>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap;">
          ${parsed.columns.map(col => {
      const vals = parsed.rows.map(r => r[col]);
      const type = detectColumnType(vals);
      const colorMap = { numeric: 'sky', categorical: 'mint', text: 'peach' };
      const typeIcon = { numeric: '🔢', categorical: '🏷️', text: '📝' };
      return `
              <span class="col-chip" style="background:var(--clay-${colorMap[type]}); box-shadow:2px 2px 0 var(--shadow-${colorMap[type]});">
                ${typeIcon[type]} ${col}
              </span>`;
    }).join('')}
        </div>
      </div>`;
  }

  async uploadToBackend(file, parsed) {
    this.uploading = true;
    this.setStatus('⬆️ Uploading to backend…', 'info');

    try {
      const result = await api.upload(file);
      this.setStatus(`✅ ${result.message}`, 'success');
      if (this.onUploadSuccess) this.onUploadSuccess(result.schema, parsed, result.file_id);
    } catch (err) {
      this.setStatus(`❌ Backend error: ${err.message}. Make sure the backend is running on localhost:8000.`, 'error');
    } finally {
      this.uploading = false;
    }
  }

  setStatus(msg, type = 'info') {
    const el = this.container.querySelector('#upload-status');
    if (!el) return;
    const colors = { info: 'var(--clay-sky)', success: 'var(--clay-mint)', error: 'var(--clay-rose)' };
    el.style.color = 'var(--text-dark)';
    el.innerHTML = `<div class="toast ${type}" style="display:inline-block;">${msg}</div>`;
  }
}
