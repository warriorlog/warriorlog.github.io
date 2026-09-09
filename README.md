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
- **`src/`** is the app:
  - `reduce.js` folds the event log into per-user state
  - `engine.js` turns the program plus your history into today's plan, and owns
    the only code that moves a ladder
  - `placement.js` turns quiz answers into starting rungs, injury ceilings and locks
  - `gamify.js` derives XP, levels, the flame, region fill and badges
  - `boss.js` picks the version of each test you have earned and scores the battle
  - `duo.js` scores the week, settles it, and replays the belt
  - `sync.js` talks to GitHub; `store.js` is IndexedDB
  Nothing derived is ever stored.

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

## Phones

Both platforms are supported and the app is installable on each.

**Android** passes the full Chromium installability checklist, so the app offers
an "Add to home screen" button during setup and installs like a native app.
Storage is shared between the browser and the installed app, so setup order does
not matter.

**iPhone** has no install prompt, so setup shows the Share → Add to Home Screen
steps instead. **Install first, then set up**: the home-screen app gets its own
storage, so anything entered in Safari beforehand would not be there afterwards.

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

## If you are ill, hurt, or away

Settings has Recovery and Travel modes. They pause your flame and make the week a
no-contest, so being ill is never scored as a defeat. A pain flag during a
session is private to your phone, and two in a week step that ladder back a rung
on purpose.

## Recovery

- **Settings → Export** — the only complete backup, private fields included.
- A phone that loses its data pulls the public branch back on next open; the
  local-only fields come from an export.
- After a deploy the installed app shows an "Update ready" toast on its next
  open, at most one launch behind once the CDN catches up.
