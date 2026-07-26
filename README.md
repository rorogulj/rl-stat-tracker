# 🚀 RL Stat Tracker

**A personal hobby project** — free, open source and not for sale. I built this because
I wanted football-style deep stats for my own Rocket League matches: the kind of
breakdowns (xG, ratings, positioning, form) that broadcast analytics give footballers,
but for my replays — and **100% local**: your replays, database and API keys never
leave your machine.

It's under active development — I keep updating it until it's genuinely good.
See the [changelog](CHANGELOG.md) for what's new.

**Built with:** React + Vite (UI), Recharts (charts), Three.js (3D replay viewer),
Node.js + Express (local server), the built-in `node:sqlite` database,
[rrrocket](https://github.com/nickbabcock/rrrocket) (Rust/boxcars replay parser),
and a dependency-free gradient-boosted-trees model written in plain JavaScript
for rank estimation.

## Install (Windows)

Paste this into PowerShell (press Start, type "powershell", Enter):

```
irm https://raw.githubusercontent.com/rorogulj/rl-stat-tracker/main/install.ps1 | iex
```

It downloads everything (including a portable Node runtime — nothing else to install),
creates a Desktop shortcut, starts the tracker at login and opens http://localhost:7845.
Re-run it anytime to update — or just click the **↑ update** button that appears in the
app when a new version is out. Your database lives in `%LOCALAPPDATA%\RLStatTracker\data`
and survives every update.

## Getting started (developers)

**Requirements:** Windows (the replay parser is a Windows binary), Node.js 22+ (uses the built-in `node:sqlite`).

```
git clone https://github.com/rorogulj/rl-stat-tracker.git
cd rl-stat-tracker
npm run setup   # installs server + client deps and builds the client
npm start
```

**Optional — start on login:** put a shortcut to `start-server.vbs` in the Startup folder
(`Win+R` → `shell:startup`) and the server runs hidden at every Windows login.

Then open `http://localhost:7845` in your browser. The server automatically:
- finds replays in `Documents\My Games\Rocket League\TAGame\DemosEpic`
- analyzes new replays (and **watches the folder** — as soon as you save a replay in-game, it shows up in your stats)
- stores everything in a local SQLite database (`server/data/stats.db`)

Manual import from the terminal: `npm run import`

## What it computes

| Category | Stats |
|---|---|
| Basics | goals, assists, saves, shots, score, MVP, shooting accuracy |
| Boost | average, used/collected (+per min), big/small pickups, stolen boost, overfill, time at 0/100, distribution 0–25/25–50/50–75/75–100 |
| Movement | meters traveled, avg/max speed, % supersonic / boost speed / slow, % ground / low air / high air |
| Positioning | field halves and thirds, behind/ahead of ball, distance to ball, last/first player back, closest to ball |
| Possession | touches (+per min), aerial touches, possession %, dribbles, passes, turnovers/takeaways |
| Kickoff | first touches, kickoff win % |
| Demolitions | inflicted / taken |
| xG | expected goals per shot (angle + distance + speed), finishing (G−xG), xG per shot, shot map |
| Rating | **component-based game rating 1–99** (attack/defense/possession/boost/pressure), normalized against the lobby, clutch bonus, demolitions counted; radar view, trend + 5-game average, personal records, tilt detector across sessions, teammate chemistry |
| Rank | real rank from tracker.gg (yours + **every player in the match**, per platform: Epic/Steam/Xbox/PSN; persistent cache, monthly refresh, newest matches first); performance-based estimate (benchmark model / calibrated heuristic); manual entry as a fallback; comparison against the average of your rank **and the next one** |
| Opponents | head-to-head record against every opponent, teammate stats |
| Visuals | position heatmap (career and per match), touch map, ball heatmap, goal timeline, field tilt, trend charts, playstyle radar, **2D replay viewer** (match animation) |

Per-mode filters (1v1 / 2v2 / 3v3) on the profile and opponents pages. "You vs. opponent average" comparison.

## Architecture

```
.replay  →  tools/rrrocket.exe  →  frame-by-frame JSON
         →  server (Node): analyzer → SQLite → Express API (localhost:7845)
         →  client (React + Vite): dashboard
```

- Parser: [rrrocket](https://github.com/nickbabcock/rrrocket) (boxcars) — reads network data at 30 fps.
  The repo ships **no binaries**: `tools/fetch-rrrocket.mjs` downloads the official release
  and verifies its SHA-256 against a hash pinned in the script before installing it.
- Custom stat engine: `server/src/analyzer.js`
- Database: built-in `node:sqlite` (no dependencies)
- Different replay folder: set the `RL_REPLAY_DIR` env variable

## Privacy & network

The server binds to `127.0.0.1` only — it is not reachable from the network, and it
**never uploads anything**. The complete list of outbound connections (all downloads):

| Host | When | What |
|---|---|---|
| `raw.githubusercontent.com` | daily | version check (`package.json`) and newer published rank models |
| `tracker.gg` | background, rate-limited | ranks of players from your matches |
| `ballchasing.com` | only if you build your own benchmark corpus | public reference replays |
| `github.com` / `codeload.github.com` | install & update only | app source (tagged release) and the official rrrocket parser |
| `nodejs.org` | install only, if you have no Node.js | portable Node runtime |

Your replays, database and API keys never leave your machine. To disable the update
check entirely, set the `RL_NO_UPDATE_CHECK=1` environment variable.

## How updates work

1. The server compares its version with `package.json` on `main` (once per 6 h).
2. If newer, an **↑ vX.Y.Z** button appears in the app — nothing installs automatically.
3. Clicking it runs [`install.ps1`](install.ps1), which downloads the **tagged release**
   (`vX.Y.Z` — an immutable, auditable snapshot, never the moving tip of main),
   rebuilds, and restarts the server. The page reloads itself when the new version is up.
4. Every release is listed in the [changelog](CHANGELOG.md) with its tag.

Re-running the install command from the top of this README does exactly the same thing.

## Benchmark corpus (optional)

Rank estimation and archetypes are calibrated against a corpus of public replays from
[ballchasing.com](https://ballchasing.com). Regular installs don't need it: trained GBDT
rank models are published in `server/models/` and every install picks up newer ones
automatically (daily check). To build your own corpus instead, put your ballchasing
API key in `server/data/ballchasing.key` (a plain text file, ignored by git) and run
`npm run benchmark:download` — a locally trained model wins over the published one
when it's newer.

All data stays on your machine: the database, your replays, and the API key live in
gitignored folders (`server/data/`, `benchmark-replays/`) and are never uploaded anywhere.
