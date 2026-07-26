# Changelog

All notable changes to RL Stat Tracker. Versions follow `0.x` while the app is
in active development; each release is tagged (`v0.1.0`) and picked up by
installed copies through the in-app update button.

## 0.3.2 — 2026-07-26

Display-correctness pass + safer backup/restore.

- Momentum graph: goal markers now sit at the right moment (they used the raw
  replay clock and a chart axis that silently dropped them entirely).
- 2D replay viewer / shot map: goal colors no longer swap when the view is
  flipped; field proportions corrected to the real arena ratio.
- Draws (forfeits) show as "D" instead of counting as losses; "why X won"
  factors are skipped for drawn matches.
- "Late winner", fastest goal and kickoff-goal records use the active game
  clock (they fired early / almost never due to countdown time).
- Labels: proper ordinals ("33rd pct"), rank-ladder deltas say "tier" (a delta
  of 1 is one tier, not one division), "benchmark player-games", Compare's
  headline number is labeled "Form (last 10)" as it always was.
- Stat formulas on the Info page match the engine's actual constants.
- Restore: safety copies are timestamped (a second restore can't overwrite the
  first backup), the WAL is folded in before backing up (no lost fresh matches),
  and an analyzer upgrade no longer wipes restored history on a machine that
  has no replay files to rebuild it from.

## 0.3.1 — 2026-07-26

Install reliability + analyzer follow-up fixes (from the second independent review).

- **Installer**: works for Windows user names with non-ASCII characters (č/š/é —
  the launcher was written as ASCII and silently broke); verifies that the system
  Node actually has `node:sqlite` instead of trusting the version number; refuses
  to touch port 7845 when a foreign application holds it (and the server itself
  now reports that clearly instead of quietly exiting).
- **Replay folder detection** follows the real Documents location (OneDrive
  redirection — the default on most consumer Windows installs). If the folder
  still isn't found, the app shows a banner explaining what to do instead of a
  green "watching" state over a non-existent path.
- **Import errors are visible**: a banner appears when replays fail to import
  (typical cause: antivirus quarantining the parser) and the server page lists
  the errors.
- **xG dedup fix**: merged shot sequences kept a stale array position, which
  could feed the rebound bonus from a later shot and mislink goals; sequences
  are also anchored to their first touch so a long dribble can't chain-merge
  a real rebound. Replays re-analyze automatically.
- **Overtime detection** now reads the replay's own overtime flag (buzzer-beater
  goals in regulation no longer count as OT).
- Match "why X won" factors use the server's team xG (own goals no longer
  inflate "clinical finishing").

## 0.3.0 — 2026-07-26

Branding release.

- Every exported image (match share card, page/element PNG exports) now carries
  a branded footer: logo + rl-stat-tracker.vercel.app.
- The app is installable as a PWA (web manifest + icons) — "Install app" in
  Chrome/Edge gives it its own window and taskbar icon.
- Desktop/Startup shortcuts created by the installer use the new logo (.ico).
- Boot splash with the logo while the app checks for the local server.

## 0.2.2 — 2026-07-26

- New logo: browser favicon, top bar, welcome page and README.

## 0.2.1 — 2026-07-26

- Server page: benchmark re-analysis progress is now a visible row with its own
  progress bar ("Analyzed X / Y replays") instead of a footnote.

## 0.2.0 — 2026-07-26

Analytics correctness release. An independent review of the stat engine was
verified claim-by-claim and everything confirmed is fixed. Replays are
re-analyzed automatically on first start after this update (a few minutes for
a typical library).

**xG**
- One attacking sequence = one chance: consecutive touches by the same player
  no longer stack xG per touch (a dribble toward goal used to register 2.7+ xG
  for a single converted chance, biasing finishing negative for dribblers).
- Rebound bonus now requires a *different* teammate's prior shot and is applied
  before probability calibration, not after.
- Calibration no longer squashes everything into [0.25, 0.83] — long-range and
  open-net chances keep their true spread.
- Own goals are no longer credited to the player who scored them (their xG and
  the team xG both went to the wrong side).
- Team xG is aggregated from the shots themselves, so unattributed chances
  count for the right team.

**Game rating**
- Impact share: an assist now counts as half a goal and team shares sum to 1
  (assists used to double-count, inflating assist-heavy teams).
- A 0-0 result is neutral instead of penalizing every player in the lobby.
- Lobby z-scores are rescaled by lobby size — a dominant 1v1 game can finally
  reach the same rating range as a dominant 3v3 game (1v1 was mathematically
  capped around 76).
- Clutch/overtime goal detection uses the active game clock instead of raw
  replay time (late regulation goals were sometimes counted as overtime).

**Stat engine**
- Overtime flag uses the active game clock.
- Big boost pads picked up above ~70% boost are no longer misclassified as
  small pads (position check against the six big-pad locations).
- Phantom pad pickups from recycled actor ids after demolitions are gone.
- Career heatmap no longer flips 180° when the profiled player's first match
  was played on the away side.
- Percentiles: the profiled player is excluded from their own comparison pool.

**Rank model**
- Validation split is now clean of player identity leakage and a constant-
  predictor baseline MAE is reported next to val MAE (Server page) — an honest
  measure of how much the model actually knows. Models will be retrained on
  the corrected pipeline when the phase-2 corpus finishes downloading.
- Models with an unknown training bucket or mismatched feature list are
  rejected instead of silently producing garbage.

## 0.1.6 — 2026-07-26

- Playstyle and coaching texts are now mode-aware: 1v1 profiles no longer get
  teammate/rotation advice ("someone has to rotate back", "coordinate cheats
  in 2v2") that only makes sense in team modes.

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
