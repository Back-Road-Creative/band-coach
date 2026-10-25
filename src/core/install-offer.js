// Holds back the browser's own install banner (beforeinstallprompt) and lets
// the page offer an Install button instead. onReady(true) when the offer
// arrives, onReady(false) once it is used or the app is installed some other
// way. A browser that never offers (every file:// copy, Safari, Firefox)
// simply never calls onReady. No window gives null.
export function watchForInstall(win, onReady) {
  if (!win || typeof win.addEventListener !== 'function') return null;
  let deferred = null;
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    onReady(true);
  });
  win.addEventListener('appinstalled', () => {
    deferred = null;
    onReady(false);
  });
  return {
    async install() {
      if (!deferred) return null;
      const e = deferred;
      deferred = null;
      onReady(false);
      try {
        await e.prompt();
        const choice = await e.userChoice;
        return (choice && choice.outcome) || null;
      } catch (err) {
        return null;
      }
    },
  };
}
