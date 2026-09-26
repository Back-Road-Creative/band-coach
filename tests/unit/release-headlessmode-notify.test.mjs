// After release.yml publishes the GitHub release, the Headless Mode site
// (Back-Road-Creative/headlessmode) should hear about it right away rather
// than waiting for its own daily poll. That requires a fine-grained token
// scoped to the headlessmode repo (this repo has no write access there), so
// the step must degrade gracefully -- warn and skip, never fail the release
// -- when the secret has not been configured yet.
//
// Workflow files can't be imported, so this asserts on the text the same
// way release-consistency-workflow.test.mjs and
// tag-workflow-version-guard.test.mjs do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url));

function workflow() {
  return readFileSync(WORKFLOW, 'utf8');
}

test('the release workflow has a step that notifies the Headless Mode site', () => {
  const text = workflow();
  const at = text.search(/- name: Notify the Headless Mode site/);
  assert.notEqual(at, -1, 'expected a "Notify the Headless Mode site" step');
  assert.ok(
    at > text.search(/- name: publish GitHub release/),
    'the notify step must run after the release is actually published',
  );
});

test('the notify step dispatches product-release to Back-Road-Creative/headlessmode for band-coach', () => {
  const text = workflow();
  const step = text.slice(text.search(/- name: Notify the Headless Mode site/));
  assert.match(step, /repos\/Back-Road-Creative\/headlessmode\/dispatches/, 'must target the headlessmode repo dispatches endpoint');
  assert.match(step, /event_type=product-release/, 'must fire the product-release event type the site listens for');
  assert.match(step, /client_payload\[product\]=band-coach/, 'must carry the band-coach product slug');
  assert.match(step, /client_payload\[tag\]/, 'must carry the tag');
});

test('the notify step is gated on the secret being configured, not run blind', () => {
  const text = workflow();
  const flagStep = text.search(/HEADLESSMODE_DISPATCH_TOKEN/);
  assert.notEqual(flagStep, -1, 'expected the secret to be checked somewhere before the notify step');
  const notifyStep = text.slice(text.search(/- name: Notify the Headless Mode site/));
  const notifyBlock = notifyStep.slice(0, notifyStep.indexOf('\n      - ', 1) === -1 ? undefined : notifyStep.indexOf('\n      - ', 1));
  assert.match(notifyBlock, /if:/, 'the notify step must be conditional');
  const ifLine = notifyBlock.match(/^\s*if:.*$/m)[0];
  assert.doesNotMatch(
    ifLine,
    /secrets\.HEADLESSMODE_DISPATCH_TOKEN/,
    'the if: condition itself can only read an env flag set from the secret in an earlier step, since if: cannot read secrets directly',
  );
});

test('a missing secret produces a visible warning instead of a dead end, and never fails the release', () => {
  const text = workflow();
  assert.match(
    text,
    /::warning::HEADLESSMODE_DISPATCH_TOKEN not set — site not notified; its daily poll picks the release up within 24h/,
    'a missing secret must say in plain language what happened and that the site will still pick it up',
  );
  const notifyStep = text.slice(text.search(/- name: Notify the Headless Mode site/));
  const notifyBlock = notifyStep.slice(0, notifyStep.indexOf('\n      - ', 1) === -1 ? undefined : notifyStep.indexOf('\n      - ', 1));
  assert.match(notifyBlock, /continue-on-error:\s*true/, 'a dispatch failure must never fail the already-completed release');
});
