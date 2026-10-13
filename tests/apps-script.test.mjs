// Runs apps-script/Code.gs in a Node VM against an in-memory spreadsheet mock.
// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function makeSheet(opts = {}) {
  const rows = [];
  const sheet = {
    rows,
    appendRow(r) {
      if (opts.failAppend) throw new Error('Service Spreadsheets failed');
      rows.push(opts.corruptWrite ? r.map((v, i) => (i === 1 ? 'BYD-XXXXXX' : v)) : [...r]);
    },
    getLastRow: () => rows.length,
    getRange(row, col, numRows = 1, numCols = 1) {
      if (typeof row === 'string') return { setNumberFormat() { return this; } };
      return {
        getValues: () => rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
        setValues(v) { v.forEach((r, i) => { rows[row - 1 + i] = [...r]; }); return this; },
        setFontWeight() { return this; },
      };
    },
    setFrozenRows() {},
  };
  return sheet;
}

function load(opts = {}) {
  const sheets = {};
  const cache = new Map();
  const ctx = {
    console: { error() {}, log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = makeSheet(opts)),
      }),
      flush() {},
    },
    LockService: { getScriptLock: () => ({ tryLock: () => !opts.lockBusy, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    Utilities: { formatDate: () => '2026-10-01 10:00:00' },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const post = (payload) => {
    const contents = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return JSON.parse(ctx.doPost({ postData: { contents } }).body);
  };
  return { post, sheet: () => sheets.Registrations, ctx };
}

const valid = { name: 'Бат-Эрдэнэ', phone: '9911 2233', slot: '13:00–15:00', utm_source: 'facebook' };

test('valid registration is stored and confirmed with an ID', () => {
  const app = load();
  const res = app.post(valid);
  assert.equal(res.ok, true);
  assert.match(res.id, /^BYD-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(res.slot, '13:00–15:00');
  const rows = app.sheet().rows;
  assert.deepEqual(rows[0].slice(0, 3), ['Timestamp', 'Registration ID', 'Name']);
  assert.equal(rows.length, 2);
  const r = rows[1];
  assert.equal(r[1], res.id);
  assert.equal(r[2], 'Бат-Эрдэнэ');
  assert.equal(r[3], '99112233');
  assert.equal(r[5], 'BYD Test Drive Event 2026-10-03');
  assert.equal(r[6], 'landing');
  assert.equal(r[7], 'facebook');
  assert.equal(r[12], 'Confirmed');
});

test('+976 prefix and dashes are normalised', () => {
  const app = load();
  assert.equal(app.post({ ...valid, phone: '+976 8910-2070' }).ok, true);
  assert.equal(app.sheet().rows[1][3], '89102070');
});

for (const [label, patch, field] of [
  ['empty name', { name: '   ' }, 'name'],
  ['one-letter name', { name: 'Б' }, 'name'],
  ['name with digits', { name: 'Бат123' }, 'name'],
  ['name with markup', { name: '<script>' }, 'name'],
  ['formula name', { name: '=HYPERLINK("x")' }, 'name'],
  ['7-digit phone', { phone: '9911223' }, 'phone'],
  ['9-digit phone', { phone: '991122334' }, 'phone'],
  ['phone starting with 1', { phone: '19112233' }, 'phone'],
  ['missing slot', { slot: '' }, 'slot'],
  ['unknown slot', { slot: '12:00' }, 'slot'],
  ['bare start time', { slot: '13:00' }, 'slot'],
]) {
  test(`rejects ${label}`, () => {
    const app = load();
    const res = app.post({ ...valid, ...patch });
    assert.deepEqual({ ok: res.ok, code: res.code, field: res.field }, { ok: false, code: 'invalid', field });
    assert.equal(app.sheet(), undefined, 'nothing written');
  });
}

test('malformed JSON is rejected', () => {
  assert.equal(load().post('{not json').code, 'bad_request');
  assert.equal(load().post('null').code, 'bad_request');
});

test('honeypot submissions are rejected without writing', () => {
  const app = load();
  assert.equal(app.post({ ...valid, website: 'http://spam' }).code, 'rejected');
  assert.equal(app.sheet(), undefined);
});

test('same phone twice returns the original registration, no second row', () => {
  const app = load();
  const first = app.post(valid);
  const again = app.post({ ...valid, phone: '99112233', slot: '17:00–19:00' });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  assert.equal(again.slot, '13:00–15:00');
  assert.equal(app.sheet().rows.length, 2);
});

test('spreadsheet failure reports an error, never success', () => {
  const app = load({ failAppend: true });
  const res = app.post(valid);
  assert.deepEqual(res, { ok: false, code: 'server_error' });
});

test('write that cannot be read back is not confirmed', () => {
  const res = load({ corruptWrite: true }).post(valid);
  assert.deepEqual(res, { ok: false, code: 'write_unverified' });
});

test('lock contention returns busy', () => {
  assert.deepEqual(load({ lockBusy: true }).post(valid), { ok: false, code: 'busy' });
});

test('tracking values are length-capped and formula-safe', () => {
  const app = load();
  app.post({ ...valid, utm_campaign: '=IMPORTXML("evil")', referrer: 'x'.repeat(1000), utm_medium: '\u0007paid' });
  const r = app.sheet().rows[1];
  assert.equal(r[9], `'=IMPORTXML("evil")`);
  assert.equal(r[11].length, 300);
  assert.equal(r[8], 'paid');
});

test('IDs are unique across many registrations', () => {
  const app = load();
  const ids = new Set();
  app.ctx.CONFIG.MAX_WRITES_PER_MINUTE = 1000;
  for (let i = 0; i < 200; i++) ids.add(app.post({ ...valid, phone: String(90000000 + i) }).id);
  assert.equal(ids.size, 200);
});

test('flood guard: writes beyond the per-minute cap are refused, not stored', () => {
  const app = load();
  app.ctx.CONFIG.MAX_WRITES_PER_MINUTE = 3;
  const codes = [0, 1, 2, 3, 4].map((i) => app.post({ ...valid, phone: String(91000000 + i) }).code || 'ok');
  assert.deepEqual(codes, ['ok', 'ok', 'ok', 'busy', 'busy']);
  assert.equal(app.sheet().rows.length, 4); // header + 3
});
