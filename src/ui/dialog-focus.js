// Focus handling for the break card (unit 7.7 item 5): a role="dialog" that
// opens over the exercise needs to move focus in, trap Tab inside itself,
// close on Escape, and give focus back to wherever it came from.

const FOCUSABLE_SELECTOR = 'button:not([hidden]):not(:disabled), [href], input:not([hidden]):not(:disabled), select:not([hidden]):not(:disabled), textarea:not([hidden]):not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Pure: where Tab/Shift+Tab moves next, wrapping at either end. */
export function nextTabIndex(currentIndex, count, shiftKey) {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  if (shiftKey) return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  return currentIndex >= count - 1 ? 0 : currentIndex + 1;
}

function focusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

/**
 * @param {{container: Element, onEscape?: () => void, doc?: Document}} opts
 * @returns {{activate: (restoreTo?: Element) => void, deactivate: () => void}}
 */
export function createFocusTrap({ container, onEscape, doc } = {}) {
  const document_ = doc || (typeof document !== 'undefined' ? document : undefined);
  let previouslyFocused = null;
  let keydownHandler = null;

  // `restoreTo`, when given, wins over document.activeElement: a caller whose
  // own click handler blurs itself before opening the dialog (this app does
  // that everywhere, to drop the click's focus ring) would otherwise leave
  // nothing real to restore focus to.
  function activate(restoreTo) {
    if (!container || !document_) return;
    previouslyFocused = restoreTo || document_.activeElement;
    const items = focusableElements(container);
    (items[0] || container).focus();
    keydownHandler = (ev) => {
      if (ev.key === 'Escape' && onEscape) {
        ev.preventDefault();
        onEscape();
        return;
      }
      if (ev.key !== 'Tab') return;
      const focusable = focusableElements(container);
      if (!focusable.length) return;
      const current = focusable.indexOf(document_.activeElement);
      const next = nextTabIndex(current, focusable.length, ev.shiftKey);
      if (next >= 0) {
        ev.preventDefault();
        focusable[next].focus();
      }
    };
    container.addEventListener('keydown', keydownHandler);
  }

  function deactivate() {
    if (container && keydownHandler) container.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    previouslyFocused = null;
  }

  return { activate, deactivate };
}
