# Security

PMR → SimGrid Helper is designed for **local use only**.

## Binding

- HTTP UI: `127.0.0.1:3847` (default)
- UDP listener: `127.0.0.1:<game port>` (default `7580`)

Do **not** reverse-proxy, port-forward, or bind these services to a public
network interface.

## Data

Session CSVs are written under `results/` on your machine.
Entrylist uploads are stored under `data/` locally.

## Reporting

If you find a security issue, open a private report via GitHub Issues or
contact the repository owner.
