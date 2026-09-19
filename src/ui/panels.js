// Feature panels: the screens beyond the instrument trainer (songs, ear
// training, theory, history, fingerings, play-along). Each feature lives in
// its own src/ui/<id>.js and registers one panel; app.js owns the switching.
//
//   const panels = createPanels();
//   panels.register({ id, name, tag, color, mount(el, api) -> { show?(), hide?() } });
//   panels.list()          -> registered panels in registration order
//   panels.open(id, el, api) mounts once (lazily, on first open), then calls show()
//   panels.close()         calls hide() on the open panel
//   panels.current()       -> the open panel's id, or null
//
// mount() runs once, the first time a panel opens, so a panel costs nothing
// until a learner asks for it.

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
      if (!mounted.has(id)) mounted.set(id, def.mount(el, api) || {});
      open = id;
      const inst = mounted.get(id);
      if (inst.show) inst.show();
    },
    close() {
      if (!open) return;
      const inst = mounted.get(open);
      open = null;
      if (inst && inst.hide) inst.hide();
    },
    current() { return open; },
  };
}
