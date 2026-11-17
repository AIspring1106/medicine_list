/* PDF text/table extraction helper for 医薬品リスト.
 * PDF.js is loaded lazily from a pinned CDN release. PDF bytes are processed in-browser.
 * Table layout is validated; ambiguous rows are not silently imported.
 */
(() => {
  'use strict';

  const PDFJS_VERSION = '6.5.438';
  const CDN_BASES = [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`,
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/`
  ];
  let pdfjsPromise = null;

  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = (async () => {
        let lastError = null;
        for (const base of CDN_BASES) {
          try {
            const library = await import(`${base}build/pdf.mjs`);
            library.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.mjs`;
            return { library, base };
          } catch (error) {
            lastError = error;
          }
        }
        throw new Error(`PDF読み込みライブラリを取得できませんでした。インターネット接続またはCDNへのアクセスを確認してください。(${lastError?.message || 'unknown'})`);
      })();
      pdfjsPromise = pdfjsPromise.catch(error => { pdfjsPromise = null; throw error; });
    }
    return pdfjsPromise;
  }

  function median(values) {
    if (!values.length) return 10;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function normalize(text) {
    return String(text || '').replace(/[\s\u200b\u00a0\u3000]/g, '').replace(/[・･:：()（）［］\[\]【】]/g, '');
  }

  function toTextItem(item) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) return null;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const fontSize = Math.max(4, Math.abs(Number(transform[0])) || Math.abs(Number(item.height)) || 10);
    const width = Math.max(0, Number(item.width) || (fontSize * item.str.length * 0.5));
    return { text: item.str, x, y, width, right: x + width, center: x + width / 2, fontSize };
  }

  function groupTextLines(items) {
    const normalized = items.map(toTextItem).filter(Boolean).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const item of normalized) {
      let target = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const candidate = lines[i];
        const tolerance = Math.max(1.8, Math.min(item.fontSize, candidate.fontSize) * 0.28);
        if (Math.abs(candidate.y - item.y) <= tolerance) { target = candidate; break; }
        if (candidate.y - item.y > Math.max(item.fontSize, candidate.fontSize) * 1.8) break;
      }
      if (!target) {
        target = { y: item.y, fontSize: item.fontSize, items: [] };
        lines.push(target);
      }
      target.items.push(item);
      target.y = target.items.reduce((sum, entry) => sum + entry.y, 0) / target.items.length;
      target.fontSize = median(target.items.map(entry => entry.fontSize));
    }
    lines.sort((a, b) => b.y - a.y);
    lines.forEach(line => line.items.sort((a, b) => a.x - b.x));
    return lines;
  }

  function makeChunks(line, gapMultiplier = 1.25) {
    const sorted = line.items.slice().sort((a, b) => a.x - b.x);
    const threshold = Math.max(4, line.fontSize * gapMultiplier);
    const chunks = [];
    for (const item of sorted) {
      const previous = chunks[chunks.length - 1];
      const gap = previous ? item.x - previous.right : Infinity;
      if (previous && gap <= threshold) {
        previous.text += item.text;
        previous.right = Math.max(previous.right, item.right);
        previous.width = previous.right - previous.x;
        previous.center = (previous.x + previous.right) / 2;
        previous.fontSize = Math.max(previous.fontSize, item.fontSize);
      } else {
        chunks.push({ text: item.text, x: item.x, right: item.right, width: item.width, center: item.center, fontSize: item.fontSize });
      }
    }
    return chunks;
  }

  const HEADER_MATCHERS = [
    /(販売名|商品名|医薬品名|品名|製品名)/,
    /(一般名|一般名称|成分名)/,
    /(薬効分類|薬効|作用分類)/
  ];

  function findHeaderAnchors(lines) {
    for (let index = 0; index < lines.length; index += 1) {
      const chunks = makeChunks(lines[index], 1.45);
      const found = HEADER_MATCHERS.map(pattern => chunks.find(chunk => pattern.test(normalize(chunk.text))));
      if (found.every(Boolean)) {
        const anchors = found.map(chunk => chunk.center);
        if (anchors[0] < anchors[1] && anchors[1] < anchors[2]) return { anchors, headerLineIndex: index };
      }
    }
    return null;
  }

  function inferColumnAnchors(lines) {
    const samples = [];
    for (const line of lines) {
      const chunks = makeChunks(line, 1.45);
      if (chunks.length === 3 && chunks.every(chunk => normalize(chunk.text))) {
        const centers = chunks.map(chunk => chunk.center);
        if (centers[0] < centers[1] && centers[1] < centers[2]) samples.push(centers);
      }
    }
    if (!samples.length) return null;
    const anchors = [0, 1, 2].map(column => median(samples.map(sample => sample[column])));
    const allowedVariation = Math.max(18, median(lines.map(line => line.fontSize)) * 3.5);
    for (let column = 0; column < 3; column += 1) {
      const deviations = samples.map(sample => Math.abs(sample[column] - anchors[column]));
      if (Math.max(...deviations) > allowedVariation) return null;
    }
    if (!(anchors[0] < anchors[1] && anchors[1] < anchors[2])) return null;
    return anchors;
  }

  function lineToCells(line, anchors) {
    const chunks = makeChunks(line, 1.45);
    const cells = ['', '', ''];
    if (chunks.length === 3) {
      return chunks.map(chunk => chunk.text.trim());
    }
    for (const chunk of chunks) {
      const column = anchors.reduce((best, anchor, index) =>
        Math.abs(chunk.center - anchor) < Math.abs(chunk.center - anchors[best]) ? index : best, 0);
      const previous = cells[column];
      if (!previous) cells[column] = chunk.text.trim();
      else {
        const spacer = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(chunk.text) ? ' ' : '';
        cells[column] = `${previous}${spacer}${chunk.text.trim()}`;
      }
    }
    return cells;
  }

  function isHeaderRow(cells) {
    const values = cells.map(normalize);
    return HEADER_MATCHERS.every((pattern, index) => pattern.test(values[index] || ''));
  }

  function appendContinuation(existing, addition) {
    if (!addition) return existing;
    if (!existing) return addition;
    const spacer = /[A-Za-z0-9]$/.test(existing) && /^[A-Za-z0-9]/.test(addition) ? ' ' : '';
    return `${existing}${spacer}${addition}`;
  }

  function extractPageRows(items, fallbackAnchors = null) {
    const lines = groupTextLines(items);
    if (!lines.length) return { rows: [], skipped: 0, recognized: false };
    const header = findHeaderAnchors(lines);
    const anchors = header?.anchors || fallbackAnchors || inferColumnAnchors(lines);
    if (!anchors) return { rows: [], skipped: 0, recognized: false };

    const mapped = lines.map((line, index) => ({
      y: line.y,
      fontSize: line.fontSize,
      index,
      cells: lineToCells(line, anchors)
    }));
    // ヘッダーは必須ではない。行がページ先頭で折り返されている場合も拾えるよう、
    // 3列すべてが埋まった行だけでなく2列以上に文字がある行から解析を開始する。
    const firstDataIndex = mapped.findIndex(row => row.cells.filter(value => value.trim()).length >= 2 && !isHeaderRow(row.cells));
    if (firstDataIndex < 0) return { rows: [], skipped: 0, recognized: true };

    const fontSize = median(mapped.slice(firstDataIndex).map(row => row.fontSize));
    const continuationGap = Math.max(4, fontSize * 1.38);
    const records = [];
    let previousLine = null;
    for (const line of mapped.slice(firstDataIndex)) {
      if (isHeaderRow(line.cells)) continue;
      const hasAny = line.cells.some(value => value.trim());
      if (!hasAny) continue;
      const isComplete = line.cells.every(value => value.trim());
      const verticalGap = previousLine ? previousLine.y - line.y : Infinity;
      const canContinue = records.length > 0 && !isComplete && verticalGap <= continuationGap;
      if (!canContinue) records.push({ cells: ['', '', ''], y: line.y, complete: false });
      const record = records[records.length - 1];
      line.cells.forEach((value, column) => {
        record.cells[column] = appendContinuation(record.cells[column], value.trim());
      });
      record.complete = record.cells.every(value => value.trim());
      previousLine = line;
    }

    const rows = records.filter(record => record.complete).map(record => record.cells.map(value => value.trim()));
    const skipped = records.length - rows.length;
    return { rows, skipped, recognized: true };
  }

  async function collectAllPages(pdf) {
    const pages = [];
    let pagesWithText = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        const items = content.items || [];
        if (items.length) pagesWithText += 1;
        pages.push(items);
      } finally {
        page.cleanup?.();
      }
    }

    // 先頭ページに見出しがあれば、その列位置を見出しのない後続ページにも共有する。
    // 全文書に見出しがなければ、全ページの行から共通のA・B・C列位置を推定する。
    const allLines = pages.flatMap((items, pageIndex) => {
      // PDF各ページは同じY座標を使うため、同じ高さの行同士が結合されないようページごとにYをずらす。
      const offset = pageIndex * 100000;
      const shifted = items.map(item => {
        const transform = Array.isArray(item.transform) ? item.transform.slice() : item.transform;
        if (Array.isArray(transform) && transform.length > 5) transform[5] = (Number(transform[5]) || 0) - offset;
        return { ...item, transform };
      });
      return groupTextLines(shifted);
    });
    const documentHeader = findHeaderAnchors(allLines);
    const sharedAnchors = documentHeader?.anchors || inferColumnAnchors(allLines);

    const allRows = [];
    let recognizedPages = 0;
    let tablePages = 0;
    let skippedRows = 0;
    const pageResults = [];
    pages.forEach((items, index) => {
      const localResult = extractPageRows(items, sharedAnchors);
      pageResults.push({ page: index + 1, ...localResult });
      if (localResult.recognized) recognizedPages += 1;
      if (localResult.rows.length) tablePages += 1;
      allRows.push(...localResult.rows);
      skippedRows += localResult.skipped;
    });

    return { rows: allRows, pages: pdf.numPages, pagesWithText, recognizedPages, tablePages, skippedRows, pageResults };
  }

  async function readAllTablesAsRows(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 16) throw new Error('PDFファイルが空、または破損しています。');
    if (arrayBuffer.byteLength > 50 * 1024 * 1024) throw new Error('PDFファイルが大きすぎます（上限50 MB）。必要なページだけに分けてください。');
    const { library, base } = await loadPdfJs();
    const loadingTask = library.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true,
      isEvalSupported: false,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`
    });

    let pdf = null;
    try {
      pdf = await loadingTask.promise;
      if (pdf.numPages > 150) throw new Error('PDFのページ数が多すぎます（上限150ページ）。表のあるページだけに分けてください。');
      const result = await collectAllPages(pdf);
      if (!result.pagesWithText) throw new Error('文字情報を取得できませんでした。画像を貼り付けたスキャンPDFは読み取れません。文字を選択できるPDF、CSVまたはXLSXを使用してください。');
      if (!result.rows.length) throw new Error('全ページを確認しましたが、3列の表データを検出できませんでした。列順がA列＝販売名、B列＝一般名、C列＝薬効であること、または同じ列位置で整列された表であることを確認してください。');

      const uniqueRows = [];
      const seen = new Set();
      for (const row of result.rows) {
        if (row.length !== 3 || row.some(value => !String(value || '').trim())) { result.skippedRows += 1; continue; }
        const normalizedRow = row.map(value => String(value).trim());
        const key = JSON.stringify(normalizedRow);
        if (!seen.has(key)) { seen.add(key); uniqueRows.push(normalizedRow); }
      }
      if (!uniqueRows.length) throw new Error('有効な3列データがありません。');
      if (result.skippedRows > Math.max(3, uniqueRows.length * 0.3)) {
        throw new Error(`表の一部を正しく区切れませんでした（読み取り対象外 ${result.skippedRows} 行）。列が崩れたPDFの可能性があります。元の表からCSVまたはXLSXで出力してください。`);
      }
      return {
        rows: uniqueRows,
        pages: result.pages,
        pagesWithText: result.pagesWithText,
        recognizedPages: result.recognizedPages,
        tablePages: result.tablePages,
        skippedRows: result.skippedRows,
        warnings: result.skippedRows ? [`不完全な行を${result.skippedRows}行除外しました。`] : [],
        pageResults: result.pageResults
      };
    } catch (error) {
      if (error?.name === 'PasswordException') throw new Error('パスワードで保護されたPDFには対応していません。保護を解除したPDFを使用してください。');
      if (error?.name === 'InvalidPDFException' || /Invalid PDF|Failed to parse PDF/i.test(error?.message || '')) throw new Error('PDFの形式を解析できませんでした。ファイルが破損していないか確認してください。');
      throw error;
    } finally {
      try { await pdf?.destroy?.(); } catch (error) { /* cleanup best effort */ }
    }
  }

  window.PdfTableReader = {
    readAllTablesAsRows,
    // Backward-compatible alias for older callers; implementation scans every page.
    readFirstTableAsRows: readAllTablesAsRows,
    // Exposed only to allow deterministic layout tests without uploading PDF data.
    __test: { groupTextLines, makeChunks, findHeaderAnchors, inferColumnAnchors, extractPageRows, collectAllPages }
  };
})();
