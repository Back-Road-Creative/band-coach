// Reads the XML report appcert.exe (the Windows App Certification Kit) writes
// and exits non-zero when it says FAIL, listing the failed tests. Wired into
// .github/workflows/store-package.yml after run-wack.ps1 and before the appx
// upload, so a package Partner Center's own WACK pass would reject never
// produces an artifact that looks finished.
//
// OVERALL_RESULT is PASS, WARNING (only OPTIONAL tests failed -- Partner
// Center accepts these) or FAIL. Anything else, including a missing or empty
// report, is not a pass: appcert that did not run is not appcert that passed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : '';
};

export function wackVerdict(xml) {
  const overall = attr(/<REPORT\b[^>]*>/.exec(xml || '')?.[0] || '', 'OVERALL_RESULT').toUpperCase();
  const failures = [];
  const warnings = [];
  for (const m of (xml || '').matchAll(/<TEST\b([^>]*)>([\s\S]*?)<\/TEST>/g)) {
    const result = /<RESULT>\s*(?:<!\[CDATA\[)?\s*([A-Z]+)/.exec(m[2])?.[1];
    if (result !== 'FAIL') continue;
    const name = attr(m[1], 'NAME');
    (attr(m[1], 'OPTIONAL').toUpperCase() === 'TRUE' ? warnings : failures).push(name);
  }
  return { overall, pass: overall === 'PASS' || overall === 'WARNING', failures, warnings };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/wack-verdict.mjs <wack-report.xml>');
    process.exit(2);
  }
  // appcert writes UTF-16 with a BOM on some builds; accept either.
  const buf = readFileSync(path);
  const xml = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const v = wackVerdict(xml);
  console.log(`WACK overall result: ${v.overall || '(none)'}`);
  for (const w of v.warnings) console.log(`  warning (optional test failed): ${w}`);
  for (const f of v.failures) console.log(`  FAILED: ${f}`);
  if (!v.pass) process.exit(1);
}
