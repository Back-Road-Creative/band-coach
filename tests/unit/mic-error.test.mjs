// micErrorMessage(err): a failed microphone start is named for what actually
// went wrong. Every failure used to say "allow it in the browser", which sends
// a learner with no microphone, or one held by a call app, to a permission
// setting that was never the problem.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { micErrorKind, micErrorMessage } from '../../src/core/mic-error.js';
import { setLocale, en, es } from '../../src/core/i18n.js';

afterEach(() => setLocale('en'));

const named = (name) => Object.assign(new Error(name), { name });

test('each failure name maps to its own kind', () => {
  assert.equal(micErrorKind(named('NotAllowedError')), 'blocked');
  assert.equal(micErrorKind(named('PermissionDeniedError')), 'blocked');
  assert.equal(micErrorKind(named('NotFoundError')), 'notFound');
  assert.equal(micErrorKind(named('NotReadableError')), 'busy');
  assert.equal(micErrorKind(named('OverconstrainedError')), 'constraints');
  assert.equal(micErrorKind(named('SecurityError')), 'insecure');
  assert.equal(micErrorKind(named('NoAudioContext')), 'noAudio');
});

test('anything else, including a non-error, is the honest generic kind, never "blocked"', () => {
  for (const e of [new TypeError('x'), named('AbortError'), undefined, null, 'boom', {}]) assert.equal(micErrorKind(e), 'unknown', String(e));
});

test('the blocked text is the permission advice; no other cause says "blocked" or "allow"', () => {
  assert.match(micErrorMessage(named('NotAllowedError')), /^The microphone was blocked\. Allow it in the browser/);
  for (const n of ['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError', 'NoAudioContext', 'Whatever']) {
    const m = micErrorMessage(named(n));
    assert.doesNotMatch(m, /blocked|\ballow\b/i, n + ': ' + m);
  }
});

test('the causes read differently from each other and say what to do', () => {
  assert.match(micErrorMessage(named('NotFoundError')), /no microphone/i);
  assert.match(micErrorMessage(named('NotReadableError')), /another (program|app)/i);
  const all = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError', 'NoAudioContext', 'Whatever'].map((n) => micErrorMessage(named(n)));
  assert.equal(new Set(all).size, all.length, 'seven causes, seven different sentences');
});

test('the start variant keeps the exact start-flow advice for a blocked mic and is otherwise unchanged', () => {
  assert.match(micErrorMessage(named('NotAllowedError'), { start: true }), /microphone was blocked.*Set up input.*Connect microphone/s);
  assert.equal(micErrorMessage(named('NotFoundError'), { start: true }), micErrorMessage(named('NotFoundError')));
});

test('Spanish is served for every cause when that locale is on', () => {
  setLocale('es');
  for (const n of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError', 'NoAudioContext', 'Whatever']) {
    const m = micErrorMessage(named(n));
    assert.ok(Object.values(es).includes(m) && !Object.values(en).includes(m), n + ' not in Spanish: ' + m);
  }
});
