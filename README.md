# PMR Results Helper

Unofficial local helper for **Project Motor Racing** race admins.

It listens to PMR UDP telemetry on your PC and captures practice, qualifying,
and race results (live table, lap times, CSV export, optional entry-list
mapping). **No SimHub required.**

Built as a general **results capture** tool. Exported tables/CSV/JSON can be
used wherever you publish league results.

> Not affiliated with Straight4 Games / Project Motor Racing. Runs on `127.0.0.1` only.

## Download (recommended)

1. Open the latest [GitHub Release](https://github.com/Ricozwar/pmr-results-helper/releases)
2. Download the ZIP
3. Read **`README FIRST.txt`**
4. Install [Node.js LTS](https://nodejs.org/) (≥ 18) once
5. Double-click **`START.bat`**
6. Open http://127.0.0.1:3847

## What it does

- Live classification from PMR UDP (default port `7580`)
- Automatic weekend segments: **Practice / Qualifying / Race**
- Auto-saves CSV files into `results/` (example: `Quali_Kyalami_22.09.2026.csv`)
- **Race pre-finish capture:** standings are locked just before the leader finishes (PMR often corrupts results after the line). Race also writes a `*_laps.csv` with per-lap times.
- Click a row to expand lap times
- Race-only penalties (seconds added to total time; positions not re-sorted)
- Optional **Save standings now** during a live race (manual pre-finish lock)
- Optional export wizard: upload CSV + JSON entry lists → mapped table + TSV/JSON

## UDP setup in PMR

Settings → Preferences:

- UDP Enabled: On
- Host: `127.0.0.1`
- Port: same as the helper (usually `7580`)

Close SimHub (or change both ports) if `7580` is already taken.

## License

Proprietary freeware — free for personal / league admin use.
See [LICENSE](LICENSE). No resale / competing redistribution.

## Security

The HTTP UI and UDP socket bind to localhost only. Do not forward these ports
to the internet. See [SECURITY.md](SECURITY.md).

## Support

Use [GitHub Issues](https://github.com/Ricozwar/pmr-results-helper/issues).

## Buy me a coffee

If this helper saved you time on race night, optional tip via Revolut:
[revolut.me/krzysze55m](http://revolut.me/krzysze55m)
