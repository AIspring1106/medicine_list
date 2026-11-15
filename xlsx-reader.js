/* xlsx-reader.js - first-worksheet XLSX reader using browser ZIP/XML primitives.
 * Reads columns A-C only. XLSX data remains in the browser on this device.
 */
(() => {
  'use strict';
  const decoder = new TextDecoder('utf-8');
  function findEOCD(view) {
    const min = Math.max(0, view.byteLength - 65557);
    for (let p = view.byteLength - 22; p >= min; p--) {
      if (view.getUint32(p, true) === 0x06054b50) return p;
    }
    throw new Error('ExcelファイルのZIP構造を確認できません。ファイルが破損している可能性があります。');
  }
  function normalizePath(path) {
    const parts = [];
    for (const part of String(path).replace(/^\//, '').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop(); else parts.push(part);
    }
    return parts.join('/');
  }
  function columnIndex(ref) {
    const letters = (String(ref || '').match(/^[A-Z]+/i) || [''])[0].toUpperCase();
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }
  function parseXml(text, label) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`${label} に許可されないXML宣言があります。`);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`${label} のXMLを解析できません。`);
    return doc;
  }
  function textOf(node, tag) {
    if (!node) return '';
    return [...node.getElementsByTagName(tag)].map(n => n.textContent || '').join('');
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('このブラウザーはXLSXの展開に対応していません。最新のChrome、Edge、Safari等でお試しください。');
    }
    let stream;
    try {
      stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch (error) {
      throw new Error('このブラウザーのXLSX圧縮形式に対応できません。ブラウザーを更新してください。');
    }
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const eocd = findEOCD(view);
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ExcelファイルのZIP目録が不正です。');
      const method = view.getUint16(p + 10, true);
      const compressed = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Excelファイル内のデータ位置が不正です。');
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const bodyStart = localOffset + 30 + localNameLen + localExtraLen;
      const packed = bytes.subarray(bodyStart, bodyStart + compressed);
      let content;
      if (method === 0) content = packed;
      else if (method === 8) content = await inflateRaw(packed);
      else throw new Error(`未対応のExcel圧縮形式です（${method}）。`);
      files.set(normalizePath(name), decoder.decode(content));
    }
    return files;
  }
  function attrByLocalName(node, localName) {
    for (const attr of [...(node?.attributes || [])]) if (attr.localName === localName) return attr.value;
    return '';
  }
  async function readFirstWorksheetAsRows(buffer) {
    if (!(buffer instanceof ArrayBuffer)) throw new Error('Excelファイルを読み込めませんでした。');
    const files = await readZip(buffer);
    const workbookText = files.get('xl/workbook.xml');
    const relsText = files.get('xl/_rels/workbook.xml.rels');
    if (!workbookText || !relsText) throw new Error('有効な .xlsx ファイルではありません。');
    const workbook = parseXml(workbookText, 'workbook.xml');
    const rels = parseXml(relsText, 'workbook.xml.rels');
    const sheet = workbook.getElementsByTagName('sheet')[0];
    if (!sheet) throw new Error('Excelブックにワークシートがありません。');
    const rid = attrByLocalName(sheet, 'id');
    const relation = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
    if (!relation) throw new Error('先頭ワークシートの参照先を確認できません。');
    const relationTarget = relation.getAttribute('Target');
    const target = normalizePath(relationTarget.startsWith('/') ? relationTarget : `xl/${relationTarget}`);
    const sheetText = files.get(target);
    if (!sheetText) throw new Error('先頭ワークシートのデータが見つかりません。');
    let shared = [];
    const sharedText = files.get('xl/sharedStrings.xml');
    if (sharedText) {
      const ss = parseXml(sharedText, 'sharedStrings.xml');
      shared = [...ss.getElementsByTagName('si')].map(si => textOf(si, 't'));
    }
    const doc = parseXml(sheetText, 'worksheet.xml');
    const sheetData = doc.getElementsByTagName('sheetData')[0];
    if (!sheetData) throw new Error('先頭ワークシートにセルデータがありません。');
    const rows = [];
    for (const rowNode of [...sheetData.getElementsByTagName('row')]) {
      const rowNo = Number(rowNode.getAttribute('r') || rows.length + 1);
      const values = ['', '', ''];
      for (const cell of [...rowNode.getElementsByTagName('c')]) {
        const col = columnIndex(cell.getAttribute('r'));
        if (col < 0 || col > 2) continue;
        const type = cell.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') value = textOf(cell, 't');
        else {
          const v = cell.getElementsByTagName('v')[0];
          value = v ? (v.textContent || '') : '';
          if (type === 's') value = shared[Number(value)] ?? '';
          else if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        }
        values[col] = String(value).trim();
      }
      rows.push({ rowNo, values });
    }
    rows.sort((a, b) => a.rowNo - b.rowNo);
    return rows.map(row => row.values);
  }
  window.XlsxReader = Object.freeze({ readFirstWorksheetAsRows });
})();
