# Warriorlog data branch

Per-user, per-device monthly event logs written by the phones through the GitHub
Contents API, at `log/<user>/<device>/<yyyy-mm>.jsonl`.

This branch is an orphan: it shares no history with `main`, so a workout commit
never rebuilds the site and a code push can never touch these logs.

**Never commit here from a laptop.** Each file has exactly one writer — the phone
that created it — and a hand edit would be overwritten or would break the
path-consistency check on the next pull.

Everything here is public. Body weight, effort ratings, pain flags, notes and
quiz answers are deliberately never written to this branch.
