// Settings persistence (wraps electron-store)
// Falls back to an in-memory shim if electron-store isn't installed yet.

let store;
try {
  const Store = require('electron-store');
  store = new Store({
    name: 'prompt-sweeper-settings',
    defaults: {
      watchdog: {
        enabled: true,
        autoClean: false,
        threshold: 'medium',
        ignoreList: [],
      },
      rewriter: {
        useClaude: false,
        claudeEndpoint: '',
        style: 'neutral',
      },
      teamRules: {
        paths: [],
      },
      siteWatchdog: {
        sites: [],
        digestEmail: '',
      },
    },
  });
} catch (e) {
  // Dev fallback — no persistence
  const mem = {};
  store = {
    get(k, def) { return k in mem ? mem[k] : def; },
    set(k, v) { mem[k] = v; },
    store: mem,
  };
}

function getNested(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

module.exports = {
  get(key, def) {
    const val = key ? store.get(key) : store.store;
    if (val === undefined && def !== undefined) return def;
    return val === undefined ? def : val;
  },
  set(key, val) { store.set(key, val); },
  all() { return store.store; },
};
