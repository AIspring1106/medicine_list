/* Run with: node tests/csv-reader.test.js */
'use strict';
const assert = require('node:assert/strict');
global.window = {};
require('../csv-reader.js');
const { parseRecords, stringifyRows } = window.MedicineCsvReader;

const source = '\uFEFF"販売名","一般名","薬効"\r\n"カロナール錠","アセトアミノフェン","解熱鎮痛剤"\r\n"配合,錠","成分""A""","効果\nの説明"\r\n';
const records = parseRecords(source);
assert.equal(records.length, 3);
assert.deepEqual(records[0], ['販売名', '一般名', '薬効']);
assert.deepEqual(records[1], ['カロナール錠', 'アセトアミノフェン', '解熱鎮痛剤']);
assert.deepEqual(records[2], ['配合,錠', '成分"A"', '効果\nの説明']);

// The importer discards the heading record before serializing the data rows.
const imported = records.slice(1);
const serialized = stringifyRows(imported, 3);
assert.deepEqual(parseRecords(serialized), imported);
assert.equal(parseRecords(serialized)[0][0], 'カロナール錠');
console.log('Shared CSV parser tests passed.');
