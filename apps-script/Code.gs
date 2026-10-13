/**
 * BYD Test Drive Event — registration endpoint.
 *
 * Bound to the registration spreadsheet (Extensions → Apps Script).
 * Deploy as Web app: Execute as "Me", Who has access "Anyone".
 *
 * Contract
 *   POST body (text/plain JSON): { name, phone, slot, source, utm_source, utm_medium,
 *                                  utm_campaign, utm_content, referrer, website }
 *   200 { ok: true,  id, slot, duplicate? }   — row is written and read back
 *   200 { ok: false, code, field? }           — nothing new was stored
 */

var CONFIG = {
  SHEET_NAME: 'Registrations',
  EVENT: 'BYD Test Drive Event 2026-10-03',
  STATUS: 'Confirmed',
  TIMEZONE: 'Asia/Ulaanbaatar',
  // Arrival windows, not fixed start times.
  SLOTS: ['11:00–13:00', '13:00–15:00', '15:00–17:00', '17:00–19:00', '19:00–20:00'],
  HEADERS: ['Timestamp', 'Registration ID', 'Name', 'Phone', 'Time Slot', 'Event', 'Source',
    'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'Referrer', 'Status'],
  ID_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // no 0/O, 1/I/L
  LOCK_TIMEOUT_MS: 15000,
  MAX_WRITES_PER_MINUTE: 60, // flood guard for the public endpoint
};

var COL = { ID: 2, NAME: 3, PHONE: 4, SLOT: 5 };

function doPost(e) {
  return json_(handleRegistration_(e));
}

function doGet() {
  return json_({ ok: true, service: 'byd-test-drive' });
}

/** Run once from the editor: grants permissions and creates the "Registrations" sheet with headers. */
function setup() {
  getSheet_();
}

function handleRegistration_(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents);
  } catch (err) {
    return { ok: false, code: 'bad_request' };
  }
  if (!body || typeof body !== 'object') return { ok: false, code: 'bad_request' };

  // Honeypot: real users never see or fill this field.
  if (body.website) return { ok: false, code: 'rejected' };

  var v = validate_(body);
  if (!v.ok) return v;
  var data = v.data;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) return { ok: false, code: 'busy' };

  try {
    var sheet = getSheet_();
    var existing = findByPhone_(sheet, data.phone);
    if (existing) {
      return { ok: true, duplicate: true, id: existing.id, slot: existing.slot };
    }

    if (!withinRateLimit_()) return { ok: false, code: 'busy' };

    var id = newId_(sheet);
    sheet.appendRow([
      Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      id,
      data.name,
      data.phone,
      data.slot,
      CONFIG.EVENT,
      data.source,
      data.utm_source,
      data.utm_medium,
      data.utm_campaign,
      data.utm_content,
      data.referrer,
      CONFIG.STATUS,
    ]);
    SpreadsheetApp.flush();

    // Read back before confirming: success is only reported for a row we can see.
    var last = sheet.getLastRow();
    var stored = sheet.getRange(last, COL.ID, 1, 3).getValues()[0];
    if (stored[0] !== id || String(stored[2]) !== data.phone) {
      console.error('Write verification failed', { id: id, row: last });
      return { ok: false, code: 'write_unverified' };
    }
    return { ok: true, id: id, slot: data.slot };
  } catch (err) {
    console.error('Registration failed', err && err.message);
    return { ok: false, code: 'server_error' };
  } finally {
    lock.releaseLock();
  }
}

function validate_(body) {
  var name = String(body.name == null ? '' : body.name).replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'\-]{1,59}$/u.test(name)) {
    return { ok: false, code: 'invalid', field: 'name' };
  }

  var phone = normalizePhone_(body.phone);
  if (!phone) return { ok: false, code: 'invalid', field: 'phone' };

  var slot = String(body.slot == null ? '' : body.slot);
  if (CONFIG.SLOTS.indexOf(slot) === -1) return { ok: false, code: 'invalid', field: 'slot' };

  return {
    ok: true,
    data: {
      name: name,
      phone: phone,
      slot: slot,
      source: cleanText_(body.source, 60) || 'landing',
      utm_source: cleanText_(body.utm_source, 100),
      utm_medium: cleanText_(body.utm_medium, 100),
      utm_campaign: cleanText_(body.utm_campaign, 150),
      utm_content: cleanText_(body.utm_content, 150),
      referrer: cleanText_(body.referrer, 300),
    },
  };
}

/** 8-digit Mongolian number; tolerates spaces, dashes and a +976 prefix. */
function normalizePhone_(raw) {
  var digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.indexOf('976') === 0) digits = digits.slice(3);
  return /^[5-9]\d{7}$/.test(digits) ? digits : '';
}

/** Trim, strip control chars, cap length, and neutralise spreadsheet formula injection. */
function cleanText_(value, max) {
  var s = String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('D:D').setNumberFormat('@'); // keep phone as text
    sheet.getRange('E:E').setNumberFormat('@'); // keep arrival windows as plain text
  }
  return sheet;
}

function findByPhone_(sheet, phone) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var rows = sheet.getRange(2, COL.ID, last - 1, 4).getValues(); // ID, Name, Phone, Slot
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2]) === phone) return { id: rows[i][0], slot: String(rows[i][3]) };
  }
  return null;
}

function newId_(sheet) {
  var last = sheet.getLastRow();
  var taken = last < 2 ? [] : sheet.getRange(2, COL.ID, last - 1, 1).getValues().map(function (r) { return r[0]; });
  for (var attempt = 0; attempt < 20; attempt++) {
    var id = 'BYD-';
    for (var i = 0; i < 6; i++) {
      id += CONFIG.ID_ALPHABET.charAt(Math.floor(Math.random() * CONFIG.ID_ALPHABET.length));
    }
    if (taken.indexOf(id) === -1) return id;
  }
  throw new Error('Could not allocate a unique registration ID');
}

/** Counts new rows per minute; called under the script lock so the counter is consistent. */
function withinRateLimit_() {
  var cache = CacheService.getScriptCache();
  var key = 'writes:' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0);
  if (count >= CONFIG.MAX_WRITES_PER_MINUTE) return false;
  cache.put(key, String(count + 1), 120);
  return true;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
