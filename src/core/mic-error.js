// Maps a failed microphone start to the sentence that names what really went
// wrong. Pure -- no DOM, no AudioContext. A getUserMedia rejection carries a
// DOMException whose NAME is the cause; the app used to ignore it and tell every
// learner to allow the mic, which is the wrong fix for no device, a mic held by
// a call app, or a browser with no audio engine. The app throws 'NoAudioContext'
// itself when it cannot make an AudioContext.
import { t } from './i18n.js';

const KINDS = { NotAllowedError: 'blocked', PermissionDeniedError: 'blocked', NotFoundError: 'notFound', DevicesNotFoundError: 'notFound', NotReadableError: 'busy', TrackStartError: 'busy', OverconstrainedError: 'constraints', SecurityError: 'insecure', NoAudioContext: 'noAudio' };

export function micErrorKind(err) {
  const n = err && typeof err.name === 'string' ? err.name : '';
  return Object.prototype.hasOwnProperty.call(KINDS, n) ? KINDS[n] : 'unknown';
}

// { start: true } is the Start-button flow, whose blocked advice names the
// buttons to press; every other cause reads the same in both flows.
export function micErrorMessage(err, opts) {
  const k = micErrorKind(err);
  return t('mic.err.' + k + (k === 'blocked' && opts && opts.start ? 'Start' : ''));
}
