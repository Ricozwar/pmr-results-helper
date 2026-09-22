# PMR → SimGrid Helper

Unofficial local helper for **Project Motor Racing** race admins.

It listens to PMR UDP telemetry on your PC and builds session results you can
paste into SimGrid (CSV + race form table / JSON). **No SimHub required.**

> Not affiliated with Straight4 Games or SimGrid. Runs on `127.0.0.1` only.

## Download (recommended)

1. Open the latest [GitHub Release](https://github.com/Ricozwar/pmr-simgrid-results/releases)
2. Download the ZIP
3. Read **`README FIRST.txt`**
4. Install [Node.js LTS](https://nodejs.org/) (≥ 18) once
5. Double-click **`START.bat`**
6. Open http://127.0.0.1:3847

## What it does

- Live classification from PMR UDP (default port `7580`)
- Automatic weekend segments: **Practice / Qualifying / Race**
- Auto-saves CSV files into `results/` (example: `Quali_Kyalami_22.09.2026.csv`)
- Click a row to expand lap times
- Race-only penalties (seconds added to total time; positions not re-sorted)
- SimGrid wizard: upload CSV + JSON entry lists → race form table + TSV/JSON export

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

Use [GitHub Issues](https://github.com/Ricozwar/pmr-simgrid-results/issues).
