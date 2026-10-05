// Pure: maps a failed microphone start to the sentence naming the real cause (getUserMedia's DOMException name; app.js throws NoAudioContext itself).
import { t } from './i18n.js';
const IDS = { __proto__: null, NotAllowedError: 'blocked', NotFoundError: 'notFound', NotReadableError: 'busy', OverconstrainedError: 'constraints', SecurityError: 'insecure', NoAudioContext: 'noAudio' };
export const micErrorMessage = e => t('mic.' + ((e && IDS[e.name]) || 'unknown'));
