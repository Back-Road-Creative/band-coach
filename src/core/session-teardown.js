// A learner leaving mid-session (tab hidden, pagehide, a real close/reload)
// needs every audio resource actually released -- the microphone stream
// stopped, the AudioContext suspended -- not merely a paused UI state. Two
// call sites need this (visibilitychange->hidden and pagehide), and each
// wants the SAME set of stoppers run, so this is a small ordered registry
// rather than duplicated stop logic at each site. Pure: no DOM, no
// AudioContext reference lives here -- the caller supplies its own stopper
// closures (each one owns whatever state it stops) and decides when run()
// fires.
export function createTeardown() {
  const stoppers = [];

  // Returns a remove function so a caller that only ever wants ONE stopper
  // registered (this app never re-registers on every session) still has a
  // way to take it back out, same shape as addEventListener's own removal
  // pattern.
  function add(name, fn) {
    const entry = { name, fn };
    stoppers.push(entry);
    return function remove() {
      const i = stoppers.indexOf(entry);
      if (i !== -1) stoppers.splice(i, 1);
    };
  }

  // Runs every registered stopper once, in registration order, and returns
  // the names that ran. One stopper throwing (a track already stopped by
  // something else, a suspended AudioContext that rejects) must never stop
  // the rest from running -- each is caught and swallowed independently, so
  // e.g. the mic is still released even if suspending the AudioContext
  // throws. Calling run() again (hidden, then pagehide, on the same tab)
  // simply re-runs every still-registered stopper -- it is the CALLER's
  // stoppers that make repeat runs a safe no-op (stopping an already-null
  // stream is a no-op), not this registry deduplicating anything.
  function run(reason) {
    const ran = [];
    stoppers.slice().forEach(({ name, fn }) => {
      try { fn(reason); } catch (e) { /* swallowed: the rest must still run */ }
      ran.push(name);
    });
    return ran;
  }

  function count() { return stoppers.length; }

  return { add, run, count };
}
