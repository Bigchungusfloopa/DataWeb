/**
 * Client-side CSV parser
 * Parses a CSV File object into { columns, rows, sample }
 */

export function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length === 0) throw new Error('Empty CSV file');

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"+|"+$/g, ''));

    const rows = [];
    for (let i = 1; i < Math.min(lines.length, 1001); i++) {
        const cells = splitCSVLine(lines[i]);
        if (cells.length !== headers.length) continue;
        const obj = {};
        headers.forEach((h, idx) => { obj[h] = cells[idx]; });
        rows.push(obj);
    }

    return {
        columns: headers,
        rows,
        rowCount: lines.length - 1,
        sample: rows.slice(0, 5),
    };
}

/**
 * Split a CSV line respecting quoted values.
 */
function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Detect the likely type of a column based on sample values.
 */
export function detectColumnType(values) {
    const sample = values.filter(v => v !== '' && v != null).slice(0, 20);
    const numericCount = sample.filter(v => !isNaN(parseFloat(v))).length;
    if (numericCount / sample.length > 0.8) return 'numeric';
    const uniqueCount = new Set(sample).size;
    if (uniqueCount <= 6) return 'categorical';
    return 'text';
}

/**
 * Read a File object and return parsed CSV data.
 */
export async function readCSVFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try { resolve(parseCSV(e.target.result)); }
            catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsText(file);
    });
}
