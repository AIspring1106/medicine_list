/* Run with: node tests/pdf-reader-layout.test.js */
'use strict';
const assert = require('node:assert/strict');
global.window = {};
require('../pdf-reader.js');
const { extractPageRows } = window.PdfTableReader.__test;
function item(str, x, y, width = str.length * 8, size = 10) {
  return { str, width, height: size, transform: [size, 0, 0, size, x, y] };
}

const withHeader = [
  item('販売名', 10, 700, 32), item('一般名', 230, 700, 36), item('薬効', 460, 700, 20),
  item('商品A錠', 10, 670, 48), item('成分A', 230, 670, 40), item('高血圧治療薬', 460, 670, 86),
  item('商品B錠', 10, 640, 48), item('成分B', 230, 640, 40), item('糖尿病治療薬', 460, 640, 86)
];
const headerResult = extractPageRows(withHeader);
assert.equal(headerResult.rows.length, 2);
assert.deepEqual(headerResult.rows[0], ['商品A錠', '成分A', '高血圧治療薬']);

const withoutHeader = [
  item('商品C', 10, 700, 35), item('成分C', 230, 700, 35), item('鎮痛薬', 460, 700, 45),
  item('商品D', 10, 670, 35), item('成分D', 230, 670, 35), item('抗菌薬', 460, 670, 45)
];
const noHeaderResult = extractPageRows(withoutHeader);
assert.equal(noHeaderResult.rows.length, 2);
assert.deepEqual(noHeaderResult.rows[1], ['商品D', '成分D', '抗菌薬']);

const wrappedRow = [
  item('販売名', 10, 700, 32), item('一般名', 230, 700, 36), item('薬効', 460, 700, 20),
  item('商品E錠', 10, 670, 48), item('成分E塩酸', 230, 670, 60), item('高血圧治療薬', 460, 670, 86),
  item('塩', 230, 658, 8),
  item('商品F錠', 10, 630, 48), item('成分F', 230, 630, 40), item('抗菌薬', 460, 630, 45)
];
const wrappedResult = extractPageRows(wrappedRow);
assert.equal(wrappedResult.rows.length, 2);
assert.equal(wrappedResult.rows[0][1], '成分E塩酸塩');

const ambiguous = extractPageRows([item('見出しだけ', 10, 700, 70), item('本文だけ', 10, 670, 70)]);
assert.equal(ambiguous.recognized, false);
assert.equal(ambiguous.rows.length, 0);
console.log('PDF table layout tests passed.');
