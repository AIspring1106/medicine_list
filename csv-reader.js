/* csv-reader.js - shared CSV parser for the medicine-learning PWA. */
(() => {
  'use strict';

  function parseRecords(text) {
    const source = String(text ?? '').replace(/^\uFEFF/, '');
    const records = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"' && field.trim() === '') {
        // Allow whitespace before a quoted field while removing that padding.
        field = '';
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field);
        records.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    if (field.length || row.length) {
      row.push(field);
      records.push(row);
    }
    return records;
  }

  function stringifyRows(rows, columnCount = 3) {
    const count = Math.max(1, Math.min(100, Number(columnCount) || 3));
    const quoteCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return (Array.isArray(rows) ? rows : []).map(row =>
      Array.from({ length: count }, (_, index) => quoteCell(row?.[index] ?? '')).join(',')
    ).join('\n');
  }

  window.MedicineCsvReader = Object.freeze({ parseRecords, stringifyRows });
})();
