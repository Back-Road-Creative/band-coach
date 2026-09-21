// Pure resolution of the build-injected version string into what the app
// reports and what an exported progress file's appVersion field carries. No
// DOM here -- the caller (app.js) reads the <meta name="band-coach-version">
// tag's content attribute once at startup and hands the raw string in.
//
// build/build.mjs replaces that meta tag's empty content="" placeholder with
// the real package.json version on every build; an unbuilt dev page never
// touches the placeholder, so its content stays "". DEV_VERSION exists so
// that case (and a missing meta entirely) can never be mistaken for a real
// release and can never silently surface as an empty string.
export const DEV_VERSION = '0.0.0-dev';

export function resolveAppVersion(metaContent) {
  const v = (metaContent || '').trim();
  return v || DEV_VERSION;
}
