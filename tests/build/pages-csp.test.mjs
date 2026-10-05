// The hosted (Pages) copy carries a strict hash-based Content-Security-Policy
// <meta>; the downloadable one-file build carries none. This is the part
// checkable without a browser: the policy text and where it sits. That the
// real app boots and runs its worklet under it, and that injected script is
// refused, is proved in tests/release/pages-csp-browser.test.mjs.
//
// Builds only into throwaway directories (never dist/), like pages.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPages } from '../../build/pages.mjs';

const BUILD_DIR = mkdtempSync(join(tmpdir(), 'band-coach-csp-build-'));
const PAGES_DIR = mkdtempSync(join(tmpdir(), 'band-coach-csp-pages-'));
let pagesHtml;
let releaseHtml;

before(async () => {
  await buildPages({ outDir: PAGES_DIR, buildDir: BUILD_DIR });
  pagesHtml = readFileSync(join(PAGES_DIR, 'index.html'), 'utf8');
  releaseHtml = readFileSync(join(BUILD_DIR, 'release', 'band-coach.html'), 'utf8');
});
after(() => {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  rmSync(PAGES_DIR, { recursive: true, force: true });
});

const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/gi;
const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// Every inline <script>/<style> element: the text between the tags, which is
// exactly what a CSP hash covers. The build has one of each, and the bundle
// contains no literal closing tag, so a lazy match is exact.
function inlineElements(html) {
  const out = [];
  for (const m of html.matchAll(/<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    if (/\ssrc\s*=/i.test(m[2] || '')) continue;
    out.push({ tag: m[1].toLowerCase(), index: m.index, text: m[3] });
  }
  return out;
}

function policy(html) {
  const metas = [...html.matchAll(CSP_META)];
  assert.equal(metas.length, 1, `the hosted index.html must carry exactly one CSP <meta>, found ${metas.length}`);
  const directives = {};
  for (const part of metas[0][1].split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = sources;
  }
  return { directives, index: metas[0].index };
}

test('the hosted index.html carries exactly one CSP meta, before the first inline script or style', () => {
  const { index } = policy(pagesHtml);
  const inline = inlineElements(pagesHtml);
  assert.ok(inline.length >= 3, 'the page has its bundle, stylesheet and service-worker registration inline');
  for (const el of inline) assert.ok(index < el.index, `the CSP meta must come before the inline <${el.tag}> at ${el.index}`);
  const headEnd = pagesHtml.indexOf('</head>');
  assert.ok(index < headEnd, 'the CSP meta is inside <head>');
});

test('every inline script is allowed by hash in script-src and every inline style in style-src-elem', () => {
  const { directives } = policy(pagesHtml);
  const inline = inlineElements(pagesHtml);
  const scripts = inline.filter((e) => e.tag === 'script');
  const styles = inline.filter((e) => e.tag === 'style');
  assert.ok(scripts.length >= 2 && styles.length >= 1);
  for (const el of scripts) assert.ok(directives['script-src']?.includes(sha(el.text)), `script-src lacks the hash of the inline script starting ${JSON.stringify(el.text.slice(0, 60))}`);
  for (const el of styles) assert.ok(directives['style-src-elem']?.includes(sha(el.text)), 'style-src-elem lacks the hash of the inline <style>');
  const hashes = (d) => (directives[d] || []).filter((s) => s.startsWith("'sha256-"));
  assert.equal(hashes('script-src').length, scripts.length, 'script-src carries no hash that is not an inline script');
  assert.equal(hashes('style-src-elem').length, styles.length, 'style-src-elem carries no hash that is not an inline style');
});

test('script-src never allows inline, eval or data:, and only blob: beyond the hashes', () => {
  const { directives } = policy(pagesHtml);
  const script = directives['script-src'];
  assert.ok(script, 'script-src is present');
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "'unsafe-hashes'", 'data:', '*', 'https:', 'http:']) {
    assert.ok(!script.includes(bad), `script-src must not contain ${bad}`);
  }
  assert.deepEqual(script.filter((s) => !s.startsWith("'sha256-")), ['blob:'], 'blob: (the worklet loader) is the only non-hash source');
  for (const name of Object.keys(directives)) {
    if (!/^(script|style|default)-src/.test(name)) continue;
    assert.ok(!directives[name].includes("'unsafe-eval'"), `${name} must not allow eval`);
  }
  assert.ok(!(directives['style-src-elem'] || []).includes("'unsafe-inline'"), 'inline <style> elements are by hash only');
  assert.deepEqual(directives['style-src-attr'], ["'unsafe-inline'"], 'style attributes are the one inline allowance (they cannot run script)');
});

test('everything else is closed by default and only opened where the app needs it', () => {
  const { directives } = policy(pagesHtml);
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'none'"]);
  assert.deepEqual(directives['form-action'], ["'none'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['manifest-src'], ["'self'"]);
  assert.ok(directives['worker-src'].includes("'self'"), 'the service worker is registered from this origin');
  assert.ok(directives['connect-src'].includes("'self'"));
  assert.ok(directives['connect-src'].includes('https://back-road-creative.github.io'), 'the update check and model pack read the project Pages origin');
  assert.deepEqual(directives['img-src'], ["'self'"], 'the app draws no images itself; only the manifest and touch icons load');
  for (const src of directives['connect-src']) {
    assert.ok(src === "'self'" || /^https:\/\/[a-z0-9.-]+$/.test(src), `connect-src ${src} must be 'self' or a bare https origin`);
  }
  assert.ok(!('frame-ancestors' in directives), 'frame-ancestors is ignored in a <meta>, so it is left out');
});

test('the downloadable release build has no CSP meta at all', () => {
  assert.equal([...releaseHtml.matchAll(/http-equiv\s*=\s*"?Content-Security-Policy/gi)].length, 0);
});
