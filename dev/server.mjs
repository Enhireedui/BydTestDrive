// Local preview + end-to-end harness. Runs the real apps-script/Code.gs against an in-memory sheet.
//   node dev/server.mjs            → http://localhost:5173
//   LIVE=1 node dev/server.mjs     → same page, but posts to the real Apps Script in config.js
//   GET /__mode?m=ok|fail|slow|busy|http500|unverified   switch backend behaviour
//   GET /__rows                                          stored rows as JSON
//   GET /__reset                                         empty the sheet
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PORT = Number(process.env.PORT || 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

let mode = 'ok';
const rows = [];
const sheet = {
  appendRow(r) {
    if (mode === 'fail') throw new Error('simulated Sheets outage');
    rows.push(mode === 'unverified' ? r.map((v, i) => (i === 1 ? 'BYD-LOST00' : v)) : [...r]);
  },
  getLastRow: () => rows.length,
  getRange(row, col, n = 1, m = 1) {
    if (typeof row === 'string') return { setNumberFormat() { return this; } };
    return {
      getValues: () => rows.slice(row - 1, row - 1 + n).map((r) => r.slice(col - 1, col - 1 + m)),
      setValues(v) { v.forEach((r, i) => { rows[row - 1 + i] = [...r]; }); return this; },
      setFontWeight() { return this; },
    };
  },
  setFrozenRows() {},
};
let created = false;
const ctx = vm.createContext({
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: () => (created ? sheet : null), insertSheet: () => ((created = true), sheet) }),
    flush() {},
  },
  LockService: { getScriptLock: () => ({ tryLock: () => mode !== 'busy', releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) }, // no flood cap locally
  Utilities: { formatDate: (d) => d.toISOString().replace('T', ' ').slice(0, 19) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
});
vm.runInContext(readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8'), ctx);

const DEV_CONFIG = `window.BYD_CONFIG = { endpoint: '/api/register', mapUrl: 'https://www.google.com/maps/search/?api=1&query=BYD+4S+Showroom+Ulaanbaatar' };`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/__mode') {
    mode = url.searchParams.get('m') || 'ok';
    return res.end(`mode=${mode}`);
  }
  if (url.pathname === '/__reset') {
    rows.length = 0;
    created = false;
    mode = 'ok';
    return res.end('reset');
  }
  if (url.pathname === '/__rows') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(rows, null, 2));
  }
  if (url.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 2500));
    if (mode === 'http500') { res.statusCode = 500; return res.end('error'); }
    const out = ctx.doPost({ postData: { contents: body } });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(out.body);
  }
  if (url.pathname === '/assets/js/config.js' && !process.env.LIVE) { // LIVE=1 → real Apps Script from config.js
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(DEV_CONFIG);
  }

  const path = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(normalize(ROOT))) { res.statusCode = 403; return res.end(); }
  try {
    const data = await readFile(path);
    res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(PORT, () => console.log(`BYD Test Drive dev server → http://localhost:${PORT}`));
