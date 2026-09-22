"use strict";

const { execFile } = require("child_process");

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout || ""));
    });
  });
}

async function processName(pid) {
  if (!pid) return null;
  const csv = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  const match = csv.match(/^"([^"]+)"/);
  return match ? match[1].replace(/\.exe$/i, "") : null;
}

async function udpOccupants(port) {
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return [];
  const out = await run("netstat", ["-ano", "-p", "UDP"]);
  const seen = new Map();
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/UDP\s+(\S+):(\d+)\s+\S+\s+(\d+)/i);
    if (!match) continue;
    if (Number(match[2]) !== numeric) continue;
    const pid = Number(match[3]);
    const address = match[1];
    const key = `${address}:${pid}`;
    if (!seen.has(key)) seen.set(key, { address, pid, ours: pid === process.pid });
  }
  const rows = [...seen.values()];
  await Promise.all(
    rows.map(async (row) => {
      row.name = (await processName(row.pid)) || `pid ${row.pid}`;
    })
  );
  return rows;
}

function describeOccupants(occupants) {
  if (!occupants.length) return "wolny";
  return occupants
    .map((row) => {
      const who = row.ours ? `${row.name} (ten helper)` : row.name;
      return `${row.address}:${who}`;
    })
    .join(", ");
}

module.exports = { udpOccupants, describeOccupants };
