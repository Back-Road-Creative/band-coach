// Feature panels: the screens beyond the instrument trainer (songs, ear
// training, theory, history, fingerings, play-along). Each feature lives in
// its own src/ui/<id>.js and registers one panel; app.js owns the switching.
//
//   const panels = createPanels();
//   panels.register({ id, name, tag, color, mount(el, api) -> { show?(), hide?(), destroy?() } });
//   panels.list()          -> registered panels in registration order
//   panels.open(id, el, api) mounts fresh into its own container under el, then calls show()
//   panels.close()         calls hide() then destroy() on the open panel and removes its DOM
//   panels.current()       -> the open panel's id, or null
//
// mount() runs every time a panel opens (a panel costs nothing until a
// learner asks for it, same as before) and is torn down on close: its
// container element is removed from the shared host, and its optional
// destroy() hook runs first for any cleanup beyond DOM removal (a timer, a
// window/document listener, an audio node — anything mount() held that
// closing the DOM node alone would not release). Saved panel data
// (DB.panels[<id>], via api.store) lives outside this lifecycle, so it
// survives a close/reopen even though the mounted instance does not.
//
// `api` (src/app.js's panelApi) also carries openPanel(id): P2b-3, lets a
// mounted panel open a sibling panel directly -- e.g. the Songs panel's
// "Add a song" row opening Learn this/Record a tune/Play Along.

export function createPanels() {
  const defs = [], mounted = new Map();
  let open = null;
  return {
    register(def) {
      if (!def || typeof def.id !== 'string' || !def.id || typeof def.mount !== 'function') throw new Error('a panel needs an id and a mount function');
      if (defs.some(d => d.id === def.id)) throw new Error('panel "' + def.id + '" is already registered');
      defs.push(def);
    },
    list() { return defs.slice(); },
    open(id, el, api) {
      const def = defs.find(d => d.id === id);
      if (!def) throw new Error('no panel "' + id + '"');
      if (open && open !== id) this.close();
      if (!mounted.has(id)) {
        // A real DOM el owns a document we can make this panel's own
        // container in, so closing it later removes exactly this panel's
        // DOM and nothing else's. A plain-object el (as in the unit tests,
        // which mount() never touches) has no ownerDocument, so mount()
        // just gets el itself, unchanged from before.
        const doc = el && el.ownerDocument;
        const container = doc ? doc.createElement('div') : null;
        if (container) el.appendChild(container);
        // opener: whatever had focus the instant before this panel's own
        // mount() runs (mount() itself moves focus in -- theory.js, songs.js,
        // editor.js, playalong.js all do), captured here so close() can give
        // it back later. A plain-object el has no ownerDocument, so there is
        // no real focus to capture (opener stays null, same as before this
        // change) -- the unit tests above never touch it.
        const opener = doc ? doc.activeElement : null;
        mounted.set(id, { inst: def.mount(container || el, api) || {}, container, opener });
      }
      open = id;
      const entry = mounted.get(id);
      if (entry.inst.show) entry.inst.show();
    },
    close() {
      if (!open) return;
      const entry = mounted.get(open);
      const id = open;
      open = null;
      if (entry) {
        // Captured BEFORE hide()/destroy()/remove() run below, any of which
        // can itself move focus: this is what was actually focused the
        // instant close() was asked for. If it is still something outside
        // this panel's own container -- e.g. a different nav button a real
        // click just focused on the way to closing this one -- that focus
        // is exactly where the learner meant it to land, so restoring the
        // opener would only steal it back; the restore below is only for
        // when the container we are about to remove would otherwise take
        // the focus that was inside it down with it.
        const doc = entry.container && entry.container.ownerDocument;
        const activeAtClose = doc && doc.activeElement;
        const focusIsBeingOrphaned = !activeAtClose || activeAtClose === doc.body || (entry.container && entry.container.contains(activeAtClose));
        if (entry.inst.hide) entry.inst.hide();
        if (entry.inst.destroy) entry.inst.destroy();
        if (entry.container) entry.container.remove();
        // Give focus back to whoever opened this panel -- removing the
        // container above drops focus to <body> whenever it had landed on
        // something inside (a list row, a "Back to songs" button); without
        // this a keyboard user's next Tab would start over from the top of
        // the page instead of picking up where they left off. Only restores
        // when the opener is still connected -- a saved song row that no
        // longer exists, or a plain-object el with nothing to capture, both
        // leave focus exactly where closing the panel left it.
        if (focusIsBeingOrphaned && entry.opener && entry.opener.isConnected && typeof entry.opener.focus === 'function') entry.opener.focus();
        mounted.delete(id);
      }
    },
    current() { return open; },
  };
}

// Saved panel data lives in DB.panels[<panel id>] as a plain JSON object.
// sanitizeDB keeps it through this: anything that is not a plain object, has
// an unsafe key, or is bigger than PANEL_DATA_MAX once serialised is
// dropped, so one broken panel can never stop the app from loading. Each
// panel still validates its own fields when it reads them.
export const PANEL_DATA_MAX = 256 * 1024;
const PANEL_ID = /^[a-z][a-z0-9-]{0,31}$/;
export function sanitizePanelData(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  Object.keys(v).forEach(id => {
    const x = v[id];
    if (!PANEL_ID.test(id) || !x || typeof x !== 'object' || Array.isArray(x)) return;
    let text; try { text = JSON.stringify(x); } catch (e) { return; }
    if (text.length <= PANEL_DATA_MAX) out[id] = JSON.parse(text);
  });
  return out;
}
