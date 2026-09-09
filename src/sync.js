// GitHub Contents API sync. Logs live on an orphan `data` branch, so a phone
// committing a workout never rebuilds the site and a code push can never touch
// the logs. Each (user, device, month) file has exactly one writer, so two
// phones can never contend for the same path.
import { toRemote, isSyncable, validate, migrateEvent } from './events.js';
import { parseJsonl, toJsonl, mergeEvents, b64encode, b64decode } from './util.js';

const H = (token) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

const pathFor = (e) => `log/${e.user}/${e.dev}/${e.day.slice(0, 7)}.jsonl`;
const partOf = (e) => `${e.user}/${e.dev}/${e.day.slice(0, 7)}`;

let running = false;

async function api(state, path, init = {}) {
  const c = state.config;
  const url = `${c.api}/repos/${c.owner}/${c.repo}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { ...H(state.settings.token), ...(init.headers ?? {}) } });
  } finally { clearTimeout(timer); }
}

/**
 * Push every unsynced event. Grouped by each event's OWN partition rather than
 * by the current device id: after an import, or if the device id is ever
 * regenerated, events written under the old id must still reach the repo.
 */
export async function flush(state) {
  if (running || !state.settings.token) return;
  running = true;
  try {
    const all = await state.store.allEvents();
    const pending = all.filter(e => !e.synced && isSyncable(e, { syncMetrics: state.settings.syncMetrics }));
    state.sync.pending = pending.length;
    if (!pending.length) { state.sync.status = 'idle'; return; }

    const parts = new Map();
    for (const e of pending) {
      const p = partOf(e);
      if (!parts.has(p)) parts.set(p, []);
      parts.get(p).push(e);
    }

    for (const [part, events] of parts) {
      const path = pathFor(events[0]);
      const local = all.filter(e => partOf(e) === part && isSyncable(e, { syncMetrics: state.settings.syncMetrics }));
      const ok = await putFile(state, path, local, events[0]);
      if (!ok) { state.sync.status = 'error'; return; }
      await state.store.markSynced(local.map(e => e.id));
      await new Promise(r => setTimeout(r, 1000));      // stay well inside the secondary rate limit
    }
    state.sync.pending = 0;
    state.sync.status = 'synced';
    state.sync.error = null;
  } catch (err) {
    state.sync.status = 'error';
    state.sync.error = String(err?.message ?? err);
  } finally { running = false; }
}

async function putFile(state, path, events, sample, attempt = 0) {
  const rec = await state.store.getFile(path);
  const body = {
    message: `log: ${sample.user} ${sample.day.slice(0, 7)} (${events.length} events)`,
    content: b64encode(toJsonl(events.map(toRemote))),
    branch: state.config.dataBranch,
    author: { name: sample.user === 'sean' ? 'Sean' : 'Cat', email: `${sample.user}@warriorlog.github.io` },
  };
  if (rec?.sha) body.sha = rec.sha;

  const res = await api(state, `/contents/${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  if (res.ok) {
    const json = await res.json();
    await state.store.putFile(path, { sha: json.content.sha, count: events.length, fetchedAt: Date.now() });
    return true;
  }
  if (res.status === 401 || res.status === 403) {
    const text = await res.text();
    state.sync.error = /not accessible/i.test(text)
      ? 'That token cannot write. It needs Contents: read and write on this repository.'
      : 'The sync token was rejected. Create a new one and paste it into Settings.';
    state.settings.tokenState = 'invalid';
    return false;
  }
  if ((res.status === 409 || res.status === 422) && attempt < 3) {
    // Our view of the file is stale, or the sha cache was lost. Re-read, union by
    // event id, and try again — never overwrite what is already up there.
    const remote = await getFile(state, path);
    if (remote) {
      const merged = mergeEvents(remote.events, events);
      await state.store.putFile(path, { sha: remote.sha });
      return putFile(state, path, merged, sample, attempt + 1);
    }
  }
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('retry-after') ?? 60) * 1000;
    await new Promise(r => setTimeout(r, Math.min(wait, 60000)));
    return putFile(state, path, events, sample, attempt + 1);
  }
  return false;
}

async function getFile(state, path) {
  const res = await api(state, `/contents/${path}?ref=${state.config.dataBranch}`);
  if (!res.ok) return null;
  const json = await res.json();
  const { rows, bad } = parseJsonl(b64decode(json.content ?? ''));
  return { sha: json.sha, events: rows, bad };
}

/**
 * Pull every log file. Runs WITHOUT a token when none is set or the token was
 * rejected: the repository is public, so partner status must not go stale just
 * because this phone's token expired.
 */
export async function pull(state) {
  try {
    const res = await api(state, `/git/trees/${state.config.dataBranch}?recursive=1`);
    if (!res.ok) return;
    const tree = await res.json();
    const files = (tree.tree ?? []).filter(f => f.type === 'blob' && f.path.startsWith('log/') && f.path.endsWith('.jsonl'));

    let added = 0;
    for (const f of files) {
      const known = await state.store.getFile(f.path);
      if (known?.sha === f.sha) continue;                 // unchanged since last pull
      const remote = await getFile(state, f.path);
      if (!remote) continue;

      const [, user, dev, month] = f.path.replace('.jsonl', '').split('/');
      const fresh = [];
      let rejected = 0;
      for (const raw of remote.events) {
        const e = migrateEvent(raw);
        // The path says who wrote this. An event claiming otherwise is dropped:
        // it is the only way one user's sets could land in the other's ladders.
        if (e.user !== user || e.dev !== dev || e.day?.slice(0, 7) !== month) { rejected++; continue; }
        if (e.v <= 1 && validate(e)) { rejected++; continue; }
        fresh.push(e);
      }
      const have = new Set((await state.store.allEvents()).map(e => e.id));
      const toAdd = fresh.filter(e => !have.has(e.id)).map(e => ({ ...e, part: partOf(e), synced: 1 }));
      if (toAdd.length) { await state.store.putEvents(toAdd); added += toAdd.length; }
      // Only remember the sha when nothing was rejected; otherwise refetch next time.
      await state.store.putFile(f.path, rejected ? { sha: null, partial: true } : { sha: f.sha, fetchedAt: Date.now() });
    }

    if (added) {
      state.events = await state.store.allEvents();
      const app = await import('./app.js');
      app.recompute();
      // Never redraw the screen out from under a set in progress.
      const inSession = state.route.name === 'session';
      if (!inSession) app.render(); else state.dirty = true;
    }
  } catch { /* offline: try again on the next foreground */ }
}
