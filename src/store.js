// Durable local storage. IndexedDB holds the event log; localStorage holds only
// small settings. The device id lives in IndexedDB *meta*, not localStorage:
// they are different durability domains, and a device id that outlives its
// events (or vice versa) strands unsynced work forever.
const DB_NAME = 'warriorlog';
const DB_VERSION = 1;
const SETTINGS_KEY = 'warriorlog.settings';

const byTsThenId = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** In-memory fallback used in private mode, when IDB is blocked, and by tests. */
export function memoryBackend() {
  const events = new Map(), files = new Map(), meta = new Map();
  return {
    kind: 'memory',
    async open() { return this; },
    async putEvents(list) { for (const e of list) events.set(e.id, { ...e }); },
    async allEvents() { return [...events.values()].sort(byTsThenId); },
    async unsyncedEvents() { return (await this.allEvents()).filter(e => !e.synced); },
    async markSynced(ids) { for (const id of ids) { const e = events.get(id); if (e) e.synced = 1; } },
    async getFile(path) { return files.get(path) ?? null; },
    async putFile(path, rec) { files.set(path, { path, ...rec }); },
    async allFiles() { return [...files.values()]; },
    async getMeta(k, dflt = null) { return meta.has(k) ? meta.get(k) : dflt; },
    async setMeta(k, v) { meta.set(k, v); },
    async clearAll() { events.clear(); files.clear(); meta.clear(); },
  };
}

const request = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export function idbBackend(indexedDB = globalThis.indexedDB) {
  let db = null;
  const write = (stores, fn) => new Promise((res, rej) => {
    const t = db.transaction(stores, 'readwrite');
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
    fn(...stores.map(s => t.objectStore(s)));
  });
  const read = (store, fn) => request(fn(db.transaction([store], 'readonly').objectStore(store)));

  return {
    kind: 'idb',
    async open() {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('events')) {
          const s = d.createObjectStore('events', { keyPath: 'id' });
          s.createIndex('ts', 'ts');
          s.createIndex('part', 'part');      // `${user}/${dev}/${month}` — the push grouping
          s.createIndex('synced', 'synced');
        }
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      db = await request(req);
      return this;
    },
    putEvents(list) { return write(['events'], (s) => { for (const e of list) s.put(e); }); },
    async allEvents() { return (await read('events', (s) => s.getAll())).sort(byTsThenId); },
    async unsyncedEvents() { return (await this.allEvents()).filter(e => !e.synced); },
    markSynced(ids) {
      return write(['events'], (s) => {
        for (const id of ids) {
          const g = s.get(id);
          g.onsuccess = () => { const e = g.result; if (e) { e.synced = 1; s.put(e); } };
        }
      });
    },
    async getFile(path) { return (await read('files', (s) => s.get(path))) ?? null; },
    putFile(path, rec) { return write(['files'], (s) => s.put({ path, ...rec })); },
    allFiles() { return read('files', (s) => s.getAll()); },
    async getMeta(k, dflt = null) { return (await read('meta', (s) => s.get(k))) ?? dflt; },
    setMeta(k, v) { return write(['meta'], (s) => s.put(v, k)); },
    clearAll() { return write(['events', 'files', 'meta'], (a, b, c) => { a.clear(); b.clear(); c.clear(); }); },
  };
}

/** Settings are small, synchronous and disposable — localStorage is right for them. */
export const settings = {
  read(ls = globalThis.localStorage) {
    try { return JSON.parse(ls?.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  },
  write(patch, ls = globalThis.localStorage) {
    const next = { ...this.read(ls), ...patch };
    try { ls?.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode: keep going */ }
    return next;
  },
};

/**
 * Open the best available backend. Falls back to memory (flagged `degraded`)
 * rather than refusing to run: a workout is never blocked by storage.
 */
export async function openStore({ indexedDB = globalThis.indexedDB } = {}) {
  if (indexedDB) {
    try { return { store: await idbBackend(indexedDB).open(), degraded: false }; } catch { /* fall through */ }
  }
  return { store: await memoryBackend().open(), degraded: true };
}

/**
 * The device id, persisted beside the events so the two can never disagree.
 * A regenerated id must not strand unsynced work — see sync.js, which groups by
 * each event's own partition rather than by the current device.
 */
export async function deviceId(store, rnd = Math.random) {
  let dev = await store.getMeta('dev');
  if (!dev) {
    dev = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)]).join('');
    await store.setMeta('dev', dev);
  }
  return dev;
}

/** The partition an event belongs to: one file, one writer. */
export const partOf = (e) => `${e.user}/${e.dev}/${e.day.slice(0, 7)}`;
export const pathOf = (e) => `log/${e.user}/${e.dev}/${e.day.slice(0, 7)}.jsonl`;
