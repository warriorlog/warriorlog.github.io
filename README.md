# Warriorlog

A shared, gamified training log for two people, running as a static site on
GitHub Pages: **https://warriorlog.github.io/**

No server, no framework, no build step. The phones hold the truth and push it to
this repository; the site is just the app.

## Running it locally

```bash
npm test                      # node --test, zero dependencies
python3 -m http.server 8098   # then open http://localhost:8098/
```

To check the sub-path case, run the same server from the parent folder and open
`http://localhost:8098/warriorlog/` with `basePath` temporarily set to
`'/warriorlog/'` in `config.js`.

## How it fits together

- **`data/program.json`** is the program: 38 exercises, 227 ladder rungs, seven
  weekday templates, six benchmarks and the placement quiz. Every target and
  every unlock rule is machine-checkable data, never code.
- **`data/gamification.json`** is the economy: XP values, the level curve, ranks,
  region weights, armour slots, badges, the flame, the duel and the bosses.
  The "How XP works" screen renders from this file, so it cannot drift.
- **`data/copy.json`** is every user-facing string.
- **`src/`** is the app. `engine.js` turns the program plus your history into
  today's plan; `reduce.js` folds the event log into state; `gamify.js` and
  `duo.js` derive every number on screen. Nothing derived is ever stored.

## Data, and what is public

Everything you log is an append-only event. Events live in IndexedDB on the
phone and are pushed to the orphan **`data`** branch of this repository at
`log/<user>/<device>/<yyyy-mm>.jsonl`. One device is the only writer of its own
files, so two phones can never fight over the same path.

**That branch is public.** Sets, reps and step names are visible to anyone.
These never leave the phone: body weight and measurements, how hard a set felt,
any pain you flag, your session notes, your quiz answers, and your timezone.
Settings → Export gives you the complete backup including those fields.

Log commits land on `data`, never on `main`, so a workout never rebuilds the
site and a code push can never touch the logs. **Never commit to `data` from a
laptop.**

## Sync setup, once per phone

Sean creates both tokens; Cat does not need a GitHub account.

1. github.com → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token.
2. Resource owner **warriorlog**; Repository access → Only select repositories →
   **warriorlog/warriorlog.github.io**.
3. Repository permissions → **Contents: Read and write**. Nothing else.
4. Generate, copy, and paste it into that phone under Settings → Sync.

Tokens created by an organisation owner need no approval. If the org ever stops
showing up as a resource owner, check the org's Settings → Third-party Access →
Personal access tokens.

**Install to the home screen first, then set up.** On iPhone the home-screen app
gets its own storage, so anything entered in Safari beforehand would not be there.

## Recovery

- **Settings → Export** — the only complete backup, private fields included.
- A phone that loses its data pulls the public branch back on next open; the
  local-only fields come from an export.
- After a deploy the installed app shows an "Update ready" toast on its next
  open, at most one launch behind once the CDN catches up.
