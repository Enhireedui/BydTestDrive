// Production build: copies the static site to dist/ with the real domain and endpoint filled in.
//   node scripts/build.mjs --site https://testdrive.example.mn [--endpoint https://script.google.com/macros/s/XXX/exec] [--map https://maps.app.goo.gl/XXX]
// On Netlify no flags are needed: --site comes from $URL, endpoint/map from assets/js/config.js.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));

// Netlify sets URL (primary domain) automatically; config.js supplies the defaults for endpoint and map.
const current = readFileSync(join(ROOT, 'assets/js/config.js'), 'utf8');
const site = (args.site || process.env.SITE_URL || process.env.URL || '').replace(/\/+$/, '');
const endpoint = args.endpoint || process.env.APPS_SCRIPT_URL || (current.match(/endpoint:\s*'([^']+)'/) || [])[1] || '';
const mapUrl = args.map || process.env.MAP_URL || (current.match(/mapUrl:\s*'([^']+)'/) || [])[1] || '';

const fail = (msg) => { console.error('Build failed: ' + msg); process.exit(1); };
if (!/^https:\/\/[^/\s]+$/.test(site)) fail('--site must be an https origin, e.g. https://testdrive.example.mn');
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) fail('--endpoint must be the Apps Script Web app URL ending in /exec');
if (!/^https:\/\//.test(mapUrl)) fail('--map must be an https Google Maps link');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });

writeFileSync(join(DIST, 'assets/js/config.js'),
  `window.BYD_CONFIG = {\n  endpoint: ${JSON.stringify(endpoint)},\n  mapUrl: ${JSON.stringify(mapUrl)},\n};\n`);

// Cache-bust CSS/JS with a content hash so a redeploy reaches every browser immediately.
const version = (file) => createHash('sha1').update(readFileSync(join(DIST, file))).digest('hex').slice(0, 8);
let html = readFileSync(join(ROOT, 'index.html'), 'utf8').replaceAll('https://SITE_URL', site);
if (html.includes('SITE_URL')) fail('unreplaced SITE_URL placeholder in index.html');
for (const file of ['assets/css/styles.css', 'assets/js/config.js', 'assets/js/app.js']) {
  if (!html.includes(`"${file}"`)) fail(`index.html no longer references ${file}`);
  html = html.replaceAll(`"${file}"`, `"${file}?v=${version(file)}"`);
}
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n`);
// Netlify headers (works for both Git deploys and drag-and-drop). Images long-cached; CSS/JS are versioned above.
writeFileSync(join(DIST, '_headers'), `/assets/img/*
  Cache-Control: public, max-age=604800
/assets/js/*
  Cache-Control: public, max-age=31536000, immutable
/assets/css/*
  Cache-Control: public, max-age=31536000, immutable
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
`);

console.log(`dist/ ready → ${site}\n  endpoint: ${endpoint}\n  map:      ${mapUrl}`);
