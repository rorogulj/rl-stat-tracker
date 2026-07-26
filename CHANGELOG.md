# Changelog

All notable changes to RL Stat Tracker. Versions follow `0.x` while the app is
in active development; each release is tagged (`v0.1.0`) and picked up by
installed copies through the in-app update button.

## 0.1.5 — 2026-07-26

- Added the MIT license.
- Fixed: archetype calibration now respects the selected mode on the profile
  (1v1 profiles were scored against 2v2 ranges due to a string/number mismatch).
- Fixed: parser download no longer breaks on Windows user names containing
  an apostrophe.

## 0.1.4 — 2026-07-26

- The Server nav link is shown on dev machines only; regular installs can still
  open the status page directly at `localhost:7845/server` (troubleshooting).
- README: added a profile screenshot.

## 0.1.3 — 2026-07-26

- Server tab: the ballchasing corpus download section is now shown only on
  machines that actually build their own benchmark corpus — regular installs
  no longer see an empty "0 / 27,200" panel.
- The GBDT model card is always visible and now says where each model came
  from (bundled with the app / auto-downloaded / trained locally).

## 0.1.2 — 2026-07-26

- Server tab now shows an **Updates** row — current version, up-to-date state and
  a manual "Check now" — so the update mechanism is visible even when there is
  nothing new.

## 0.1.1 — 2026-07-26

Transparency release — no binaries in the repo, auditable updates.

- The replay parser (`rrrocket.exe`) is no longer committed to the repo: it is
  downloaded from the **official rrrocket v0.11.5 release** at install time and
  verified against a SHA-256 pinned in `tools/fetch-rrrocket.mjs`.
- Installs and self-updates now use the **tagged release snapshot** (`vX.Y.Z`)
  instead of the tip of `main`.
- New README sections: **Privacy & network** (every outbound connection listed)
  and **How updates work**.
- Update check can be disabled with `RL_NO_UPDATE_CHECK=1`.

## 0.1.0 — 2026-07-26

Initial public release.

- **Replay analysis engine** — parses Rocket League replays locally (rrrocket/boxcars,
  30 fps network data) and computes 34 stats across boost, movement, positioning,
  possession, kickoffs, demolitions and xG.
- **Game rating (1–99)** — component-based rating (attack / defense / possession /
  boost / pressure) normalized against the lobby, with radar, trends, personal
  records and teammate chemistry.
- **Rank tracking & estimation** — real ranks from tracker.gg for every player in
  the match; GBDT rank model trained on a 27k-replay ballchasing benchmark corpus
  (pre-trained models ship with the app and update automatically).
- **Playstyle archetypes** — 10 archetypes scored per mode, calibrated against
  benchmark averages.
- **Match analysis** — momentum timeline, key factors, shot map, heatmaps,
  2D replay viewer.
- **Players** — opponents / teammates / favorites, head-to-head records, profiles
  with rank badges.
- **One-line installer** for Windows (`install.ps1`) with in-app self-update; all
  data stays in a local SQLite database.
