#!/usr/bin/env node
/*
 * Bygger den publika versionen av evera.care i dist/.
 *
 *   node deploy/build.mjs           bygger dist/ och skriver deploy/dist-lock.json
 *   node deploy/build.mjs --check   bygger i minnet och jämför med dist/ (ändrar inget)
 *
 * Källfilerna i repot behåller sina förklarande kommentarer. Bygget tar bort dem ur det
 * som publiceras, med riktiga parsers (terser, csso, html-minifier-terser), aldrig med
 * sök-och-ersätt. Koden skrivs inte om: ingen omdöpning av variabler och ingen
 * "compress", så beteendet är detsamma som i källan.
 *
 * - Egna skript: kommentarer bort. Licenskommentarer (@license, @preserve, /*! ... ) behålls.
 * - assets/js/vendor/: kopieras byte för byte, med sina licens- och ursprungsnotiser.
 * - CSS och HTML: kommentarer bort.
 * - .htaccess: byggs ur deploy/htaccess.template. Stilmallens CSP-hash räknas ut här.
 * - Allt annat (bilder, film, typsnitt, ikoner, manifest): kopieras byte för byte.
 *
 * deploy/manifest.json är den enda listan över vad som publiceras. Inga källkartor skapas.
 * deploy/dist-lock.json binder varje dist-fil till sin källa med SHA-256, och
 * deploy/publish.py vägrar publicera om dist/ inte stämmer med källan.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify as minifyJs } from 'terser';
import { minify as minifyCss } from 'csso';
import { minify as minifyHtml } from 'html-minifier-terser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const LOCK = join(ROOT, 'deploy/dist-lock.json');
const HTACCESS_SOURCE = 'deploy/htaccess.template';
const HTACCESS_MARKER = '# evera.care managed by deploy/publish.py';

// 'report-only' = webbläsaren rapporterar bara överträdelser i konsolen, inget blockeras.
// Byt till 'enforce' först när report-only har körts på den riktiga sajten utan överträdelser.
const CSP_MODE = 'report-only';
// Ett dygn till att börja med. Höj till 31536000 (ett år) när https har fungerat en tid.
const HSTS_MAX_AGE = 86400;

const LICENSE_COMMENT = /@license|@preserve|^!/;
const FORBIDDEN_NAME = /\.(map|ts|tsx)$/i;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sourceOf = (name) => (name === '.htaccess' ? HTACCESS_SOURCE : name);
const fail = (msg) => { console.error('Byggfel: ' + msg); process.exit(1); };

function cspPolicy(html, voiceJs) {
  const sdk = voiceJs.match(/src:\s*'(https:\/\/cdn\.jsdelivr\.net\/npm\/@elevenlabs\/client@[0-9.]+\/dist\/lib\.iife\.js)'/);
  if (!sdk) fail('hittar inte den låsta ElevenLabs-adressen i evera-voice.js');
  if (!/integrity:\s*'sha384-[A-Za-z0-9+/=]+'/.test(voiceJs)) fail('SRI-hashen för ElevenLabs-klienten saknas i evera-voice.js');
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  if (/<script(?![^>]*\ssrc=)[^>]*>/.test(html)) fail('index.html har inbäddat skript; det tillåts inte av policyn');
  if (/\sstyle=/.test(html)) fail('index.html har style-attribut; det tillåts inte av policyn');
  const styleHashes = styles.map((s) => "'sha256-" + createHash('sha256').update(s).digest('base64') + "'");
  return [
    "default-src 'none'",
    "script-src 'self' " + sdk[1] + " 'wasm-unsafe-eval'",
    ["style-src 'self'", ...styleHashes].join(' '),
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function buildHtaccess(template, policy) {
  const lines = template.split('\n');
  if (lines[0] !== HTACCESS_MARKER) fail('första raden i ' + HTACCESS_SOURCE + ' måste vara markören');
  const body = lines.slice(1).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const out = [HTACCESS_MARKER, ...body].join('\n') + '\n';
  const filled = out
    .replaceAll('{{HSTS_MAX_AGE}}', String(HSTS_MAX_AGE))
    .replaceAll('{{CSP_HEADER}}', CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only')
    .replaceAll('{{CSP_POLICY}}', policy);
  if (filled.includes('{{')) fail('ofylld platshållare i .htaccess');
  if (policy.includes('"')) fail('citattecken i CSP-policyn');
  return filled;
}

async function build() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'deploy/manifest.json'), 'utf8')).files;
  const out = new Map();
  const lock = {};
  const read = (name) => readFileSync(join(ROOT, sourceOf(name)));

  const html = await minifyHtml(read('index.html').toString('utf8'), { removeComments: true });
  const policy = cspPolicy(html, read('assets/js/evera-voice.js').toString('utf8'));

  for (const name of manifest) {
    if (FORBIDDEN_NAME.test(name)) fail('otillåten filtyp i manifestet: ' + name);
    const source = read(name);
    let result;
    if (name === '.htaccess') {
      result = Buffer.from(buildHtaccess(source.toString('utf8'), policy));
    } else if (name === 'index.html') {
      result = Buffer.from(html);
    } else if (name.startsWith('assets/js/vendor/')) {
      result = source;
    } else if (name.endsWith('.js')) {
      const r = await minifyJs(source.toString('utf8'), {
        compress: false, mangle: false, sourceMap: false,
        format: { comments: LICENSE_COMMENT, semicolons: true },
      });
      if (!r.code) fail('terser gav inget resultat för ' + name);
      if (/sourceMappingURL/.test(r.code)) fail('källkartsreferens i ' + name);
      result = Buffer.from(r.code + '\n');
    } else if (name.endsWith('.css')) {
      result = Buffer.from(minifyCss(source.toString('utf8'), { restructure: false, comments: 'exclamation' }).css + '\n');
    } else if (name.endsWith('.html')) {
      result = Buffer.from(await minifyHtml(source.toString('utf8'), { removeComments: true }));
    } else {
      result = source;
    }
    out.set(name, result);
    lock[name] = { source: sourceOf(name), sourceSha256: sha256(source), distSha256: sha256(result) };
  }
  return { out, lock, policy };
}

function walk(dir, base = dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walk(full, base));
    else files.push(relative(base, full).split('\\').join('/'));
  }
  return files;
}

const check = process.argv.includes('--check');
const { out, lock, policy } = await build();
const lockText = JSON.stringify({ cspMode: CSP_MODE, hstsMaxAge: HSTS_MAX_AGE, files: lock }, null, 2) + '\n';

if (check) {
  let existing = [];
  try { existing = walk(DIST); } catch { fail('dist/ saknas. Kör: npm run build'); }
  const problems = [];
  for (const [name, data] of out) {
    let current = null;
    try { current = readFileSync(join(DIST, name)); } catch { /* saknas */ }
    if (!current || !current.equals(data)) problems.push(name);
  }
  for (const name of existing) if (!out.has(name)) problems.push(name + ' (finns i dist/ men inte i manifestet)');
  let currentLock = '';
  try { currentLock = readFileSync(LOCK, 'utf8'); } catch { /* saknas */ }
  if (currentLock !== lockText) problems.push('deploy/dist-lock.json');
  if (problems.length) fail('dist/ stämmer inte med källan. Kör: npm run build\n  ' + problems.join('\n  '));
  console.log('dist/ stämmer med källan: ' + out.size + ' filer.');
} else {
  rmSync(DIST, { recursive: true, force: true });
  for (const [name, data] of out) {
    const target = join(DIST, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  writeFileSync(LOCK, lockText);
  console.log('Byggt dist/: ' + out.size + ' filer. CSP-läge: ' + CSP_MODE + '. HSTS max-age: ' + HSTS_MAX_AGE + '.');
  console.log('CSP: ' + policy);
}
