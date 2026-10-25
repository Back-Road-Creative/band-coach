// Tells the page when a new service worker has taken it over. The hosted
// copy's worker skips waiting and claims open pages, so a new release starts
// serving at once while this page keeps running the old code until a reload.
// A page with no controller at start is a first install, not an update, and
// a browser without service workers (every file:// copy) gets a no-op.
export function watchForUpdate(container, onUpdate) {
  if (!container || !container.controller) return false;
  let told = false;
  container.addEventListener('controllerchange', () => {
    if (told) return;
    told = true;
    onUpdate();
  });
  return true;
}
