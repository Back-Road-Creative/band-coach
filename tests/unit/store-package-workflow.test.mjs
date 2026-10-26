// The tag-triggered Store packaging workflow must refuse to build with
// placeholder identity values.
//
// store/scripts/apply-identity.mjs deliberately falls back to the committed
// placeholders when BC_IDENTITY_NAME / BC_PUBLISHER / BC_PUBLISHER_DISPLAY_NAME
// are unset, so that a local `dist:appx` still produces something runnable.
// That fallback is exactly wrong for a package headed to the Store: a missing
// repository variable would silently produce an .appx whose Identity/Name and
// Publisher are placeholders, which is rejected on upload -- or worse, is not
// noticed until after submission.
//
// GitHub Actions reads repository variables at RUN time, so a run started
// before a variable existed picks up nothing. The only defence that does not
// depend on remembering to check the manifest afterwards is to make the build
// itself fail loudly, which is what `dist:appx:submission` (--require-identity)
// does. This test pins that the workflow uses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(
  new URL('../../.github/workflows/store-package.yml', import.meta.url),
);

function workflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

test('the store-package workflow exists and is tag-triggered', () => {
  const text = workflow();
  assert.match(text, /^name: store-package$/m, 'workflow should be named store-package');
  assert.match(text, /tags:\s*\n\s*- 'v\*'/, "workflow should run on 'v*' tags");
});

test('the packaging step refuses placeholder identity', () => {
  const text = workflow();
  assert.match(
    text,
    /run: npm run dist:appx:submission$/m,
    'the packaging step must run dist:appx:submission so a missing BC_* variable fails the build',
  );
});

// Split the workflow into steps (each starts with "      - " at step indent).
function steps() {
  const text = workflow();
  const body = text.slice(text.indexOf('\n  package:'));
  return body.split(/^      - /m).slice(1);
}
const PR_ONLY = /^\s+if: github\.event_name == 'pull_request'\s*$/m;
const NOT_PR = /^\s+if: github\.event_name != 'pull_request'\s*$/m;

test('the plain dist:appx target runs only on pull_request, never on tag or dispatch', () => {
  const plain = steps().filter((s) => /^\s*run: npm run dist:appx\s*$/m.test(s));
  assert.equal(plain.length, 1, 'exactly one step runs the non-submission dist:appx (the PR build)');
  assert.match(plain[0], PR_ONLY, 'dist:appx falls back to placeholders silently; it must be gated to pull_request');
});

test('the workflow has a pull_request trigger limited to store/** and this workflow', () => {
  const text = workflow();
  const on = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
  assert.match(on, /pull_request:\s*\n\s+paths:\s*\n\s+- 'store\/\*\*'\s*\n\s+- '\.github\/workflows\/store-package\.yml'/);
  assert.match(on, /workflow_dispatch/);
  assert.match(on, /tags:\s*\n\s*- 'v\*'/);
});

test('every step that runs dist:appx:submission or reads the identity variables is off pull_request', () => {
  const hits = steps().filter((s) => /dist:appx:submission|vars\.BC_/.test(s));
  assert.ok(hits.length >= 1);
  for (const s of hits) assert.match(s, NOT_PR, `step must be skipped on pull_request:\n${s}`);
});

test('the manifest check, which rejects placeholder identity, is skipped on pull_request', () => {
  const s = steps().find((x) => /verify-appx\.mjs/.test(x));
  assert.match(s, NOT_PR);
});

test('a pull_request run still launches the packaged app and runs WACK', () => {
  for (const re of [/--smoke-test/, /run-wack\.ps1/]) {
    const s = steps().find((x) => re.test(x));
    assert.ok(s, `missing step for ${re}`);
    assert.doesNotMatch(s, NOT_PR);
    assert.doesNotMatch(s, /ref_type == 'tag'/);
  }
});

test('superseded pull_request runs are cancelled, other runs never', () => {
  const text = workflow();
  assert.match(text, /^concurrency:\s*\n\s+group: .*\n\s+cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/m);
});

test('all three identity variables are still passed to the packaging step', () => {
  const text = workflow();
  for (const name of ['BC_IDENTITY_NAME', 'BC_PUBLISHER', 'BC_PUBLISHER_DISPLAY_NAME']) {
    assert.match(
      text,
      new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`),
      `${name} must still reach the build as a repository variable`,
    );
  }
});

test('the workflow comment no longer presents the placeholder fallback as fine', () => {
  const text = workflow();
  assert.doesNotMatch(
    text,
    /falls back to the safe placeholders/,
    'that comment described the old dist:appx behaviour and is now misleading',
  );
});

// The Store package must carry the RELEASE build: minified, debug hook off,
// version stamped into the footer. `npm run build` alone writes the dev build
// to dist/band-coach.html, and prepare-app quietly accepted it, so every .appx
// this workflow produced shipped the dev HTML with a blank version footer.
test('the build step produces the release file, not the dev build', () => {
  const text = workflow();
  assert.match(
    text,
    /run: \|\n\s+npm ci\n\s+npm run build -- --release$/m,
    'the build step must run a --release build so prepare-app stages dist/release/band-coach.html',
  );
});
