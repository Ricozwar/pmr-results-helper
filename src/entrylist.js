"use strict";

function clean(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/^"+|"+$/g, "")
    .trim();
}

function norm(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function stripIdPrefix(id) {
  const s = clean(id);
  return s.replace(/^[PMS]/i, "");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => norm(h));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      const val = clean(cols[idx]);
      // duplicate header names (SimGrid CSV): keep first non-empty
      if (row[h] == null || row[h] === "") row[h] = val;
    });
    rows.push(row);
  }
  return rows;
}

function pick(row, ...keys) {
  for (const key of keys) {
    const n = norm(key);
    if (row[n] != null && String(row[n]).trim() !== "") return clean(row[n]);
  }
  return "";
}

function parseCsvEntrylist(text) {
  return parseCsv(text)
    .map((row) => {
      const username = pick(row, "username");
      if (!username) return null;
      return {
        username,
        realName: pick(row, "real name", "realname"),
        platform: pick(row, "platform"),
        psnUsername: pick(row, "psn_username", "psn username"),
        steamUsername: pick(row, "steam_username", "steam username"),
        xboxUsername: pick(row, "xbox_username", "xbox username"),
        psnId: pick(row, "psn_id", "psn id"),
        steam64Id: pick(row, "steam64_id", "steam64 id"),
        xboxId: pick(row, "xbox_id", "xbox id"),
        carClass: pick(row, "car class", "carclass"),
        carName: pick(row, "car name", "carname"),
        carNumber: pick(row, "car number", "#", "car number"),
      };
    })
    .filter(Boolean);
}

function parseJsonEntrylist(textOrObj) {
  const data = typeof textOrObj === "string" ? JSON.parse(textOrObj) : textOrObj;
  const entries = Array.isArray(data?.entries) ? data.entries : Array.isArray(data) ? data : [];
  const drivers = [];
  for (const entry of entries) {
    const list = entry.drivers || [];
    for (const d of list) {
      const firstName = clean(d.firstName);
      const lastName = clean(d.lastName);
      drivers.push({
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        shortName: clean(d.shortName),
        playerID: clean(d.playerID),
        playerIdBare: stripIdPrefix(d.playerID),
      });
    }
  }
  return drivers;
}

function mergeEntrylist(csvRows, jsonDrivers) {
  const byBareId = new Map();
  for (const d of jsonDrivers) {
    if (d.playerIdBare) byBareId.set(d.playerIdBare, d);
  }

  return csvRows.map((csv) => {
    const ids = [csv.psnId, csv.xboxId, csv.steam64Id].map(stripIdPrefix).filter(Boolean);
    let json = null;
    for (const id of ids) {
      if (byBareId.has(id)) {
        json = byBareId.get(id);
        break;
      }
    }
    const aliases = new Set(
      [
        csv.username,
        csv.realName,
        csv.psnUsername,
        csv.steamUsername,
        csv.xboxUsername,
        json?.fullName,
        json?.firstName,
        json?.lastName,
        json ? `${json.firstName} ${json.lastName}` : "",
      ]
        .map(norm)
        .filter(Boolean)
    );
    return {
      ...csv,
      firstName: json?.firstName || "",
      lastName: json?.lastName || "",
      fullName: json?.fullName || csv.realName || csv.username,
      playerID: json?.playerID || "",
      aliases: [...aliases],
    };
  });
}

function matchName(name, entry) {
  const n = norm(name);
  if (!n) return false;
  if (entry.aliases.includes(n)) return true;
  // tolerate clan tags like [ZWM] Rico
  const stripped = n.replace(/\[[^\]]*\]/g, "").trim();
  if (stripped && entry.aliases.includes(stripped)) return true;
  for (const alias of entry.aliases) {
    if (alias && (n.includes(alias) || alias.includes(n))) return true;
  }
  return false;
}

/**
 * Build SimGrid race form rows from live results + merged entrylist + penalties.
 * penalties: { [inGameName|vehicleId]: seconds }
 */
function buildSimgridRaceTable(liveRows, mergedEntries, penalties = {}) {
  const used = new Set();
  const rows = [];

  const sortedLive = [...(liveRows || [])].sort((a, b) => (a.position || 999) - (b.position || 999));

  for (const live of sortedLive) {
    const inGame = live.inGameName || live.name || "";
    const entry = mergedEntries.find((e) => !used.has(e.username) && matchName(inGame, e));
    if (entry) used.add(entry.username);

    const penaltyKey = String(live.vehicleId ?? inGame);
    const penaltySec =
      Number(penalties[penaltyKey] ?? penalties[inGame] ?? live.penaltySec ?? 0) || 0;
    const baseTotal = live.totalTimeMs ?? live.totalTime ?? null;
    const totalWithPenalty =
      baseTotal != null && Number.isFinite(baseTotal) ? baseTotal + Math.round(penaltySec * 1000) : null;

    rows.push({
      position: live.position || rows.length + 1,
      name: entry?.username || "",
      inGameName: inGame,
      realName: entry?.fullName || "",
      className: entry?.carClass || live.carClass || "",
      carNum: entry?.carNumber || null,
      car: entry?.carName || live.car || "",
      laps: live.totalLaps ?? live.completedLaps ?? null,
      bestLapMs: live.bestLap ?? live.bestLapMs ?? null,
      totalTimeMs: totalWithPenalty,
      totalTimeBaseMs: baseTotal,
      penaltySec,
      dnf: Boolean(live.dnf),
      dns: false,
      unmapped: !entry,
      vehicleId: live.vehicleId,
    });
  }

  for (const entry of mergedEntries) {
    if (used.has(entry.username)) continue;
    rows.push({
      position: rows.length + 1,
      name: entry.username,
      inGameName: "",
      realName: entry.fullName || entry.username,
      className: entry.carClass || "",
      carNum: entry.carNumber || null,
      car: entry.carName || "",
      laps: null,
      bestLapMs: null,
      totalTimeMs: null,
      totalTimeBaseMs: null,
      penaltySec: 0,
      dnf: false,
      dns: true,
      unmapped: false,
      vehicleId: null,
    });
  }

  // Re-number positions 1..n for form display after DNS append
  rows.forEach((r, i) => {
    r.position = i + 1;
  });

  return rows;
}

function formatRaceTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const total = Math.round(ms);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

function raceTableToTsv(rows) {
  const header = ["POS", "NAME", "CLASS", "#", "CAR", "LAPS", "BEST LAP", "TOTAL TIME", "DNF", "DNS"];
  const lines = [header.join("\t")];
  for (const r of rows) {
    lines.push(
      [
        r.position,
        r.name,
        r.className,
        r.carNum ?? "",
        r.car,
        r.laps ?? "",
        formatRaceTime(r.bestLapMs),
        formatRaceTime(r.totalTimeMs),
        r.dnf ? "X" : "",
        r.dns ? "X" : "",
      ].join("\t")
    );
  }
  return lines.join("\n");
}

function raceTableToSimgridJson(rows) {
  const byClass = new Map();
  for (const r of rows) {
    const cls = r.className || "unknown";
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(r);
  }
  const payload = [];
  for (const [carClass, list] of byClass.entries()) {
    payload.push({
      carClass,
      result: list.map((r) => ({
        position: r.position,
        id: r.name || r.inGameName || "",
        carNum: r.carNum ? Number(r.carNum) || r.carNum : null,
        car: r.car || "",
        pointsGiven: 0,
        penaltyPoints: r.penaltySec || null,
        pointTotal: 0,
        totalLaps: r.dns ? null : r.laps,
        bestLap: r.dns ? null : r.bestLapMs,
        totalTime: r.dns || r.dnf ? null : r.totalTimeMs,
        dnf: Boolean(r.dnf),
        dns: Boolean(r.dns),
      })),
    });
  }
  return payload;
}

module.exports = {
  parseCsvEntrylist,
  parseJsonEntrylist,
  mergeEntrylist,
  matchName,
  buildSimgridRaceTable,
  formatRaceTime,
  raceTableToTsv,
  raceTableToSimgridJson,
  stripIdPrefix,
  norm,
};
