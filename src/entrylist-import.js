"use strict";

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function addMapping(map, from, to) {
  const key = clean(from);
  const id = clean(to);
  if (!key || !id) return;
  map[key] = id;
}

function isPlatformId(value) {
  const v = clean(value);
  return /^([PSM])\d{8,}$/i.test(v) || /^S\d{15,}$/i.test(v);
}

function nameVariants(firstName, lastName, shortName) {
  const first = clean(firstName);
  const last = clean(lastName);
  const short = clean(shortName);
  const full = clean(`${first} ${last}`);
  const variants = new Set();
  if (full) variants.add(full);
  if (short) variants.add(short);
  if (first && last) variants.add(`${last} ${first}`);
  // bez dopisków teamowych typu "CART" / "QBR"
  if (full) {
    variants.add(full.replace(/\s*[-|]?\s*\b(cart|qbr|jrtp|hrt|sfr|bpl)\b.*$/i, "").trim());
  }
  return [...variants].filter(Boolean);
}

function pickSimgridId(driver) {
  const candidates = [
    driver.username,
    driver.simgridId,
    driver.simgrid_id,
    driver.id,
    driver.name,
    driver.registration_username,
    driver.playerName,
  ];
  for (const c of candidates) {
    const v = clean(c);
    if (v && !isPlatformId(v)) return v;
  }
  // Entrylist_PMR.json nie ma username SimGrid — użyj imienia i nazwiska, nie playerID.
  const full = clean(`${driver.firstName || ""} ${driver.lastName || ""}`);
  if (full) return full;
  return clean(driver.playerID);
}

function parseJsonEntrylist(data) {
  const mappings = {};
  const entryList = [];
  const roster = [];

  let entries = [];
  if (Array.isArray(data)) entries = data;
  else if (Array.isArray(data?.entries)) entries = data.entries;
  else if (Array.isArray(data?.drivers)) entries = data.drivers.map((d) => ({ drivers: [d] }));
  else if (data && typeof data === "object" && !data.entries) {
    // { "InGame Name": "simgrid_id", ... }
    for (const [from, to] of Object.entries(data)) {
      if (typeof to === "string" || typeof to === "number") addMapping(mappings, from, to);
    }
    return {
      mappings,
      entryList: [...new Set(Object.values(mappings).filter((v) => !String(v).startsWith("__")))],
      roster: [],
      source: "json-map",
    };
  }

  for (const entry of entries) {
    const drivers = Array.isArray(entry?.drivers)
      ? entry.drivers
      : entry?.firstName || entry?.lastName || entry?.playerID || entry?.username
        ? [entry]
        : [];

    for (const driver of drivers) {
      const first = clean(driver.firstName);
      const last = clean(driver.lastName);
      const full = clean(`${first} ${last}`);
      const id = pickSimgridId(driver);
      if (!id || isPlatformId(id)) continue;

      entryList.push(id);
      roster.push({
        id,
        firstName: first,
        lastName: last,
        fullName: full,
        shortName: clean(driver.shortName),
        playerID: clean(driver.playerID),
        carNum: entry.raceNumber ?? driver.carNumber ?? null,
      });

      for (const variant of nameVariants(first, last, driver.shortName)) {
        addMapping(mappings, variant, id);
      }
      // playerID → id tylko gdy mamy sensowny id SimGrid (nie platformowy)
      if (driver.playerID && !isPlatformId(id)) addMapping(mappings, driver.playerID, id);
    }
  }

  return {
    mappings,
    entryList: [...new Set(entryList)],
    roster,
    source: "json-entrylist",
  };
}

function parseCsvEntrylist(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { mappings: {}, entryList: [], roster: [], source: "csv" };

  const splitCsv = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => clean(c.replace(/^"|"$/g, "").replace(/&quot;/g, "")));
  };

  const header = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iUser = idx(["username", "user", "simgrid", "simgrid id", "id"]);
  const iReal = idx(["real name", "realname", "name", "displayname"]);
  const iReg = idx(["registration_username", "registration username"]);
  const iClass = idx(["car class", "class"]);
  const iCar = idx(["car name", "car"]);
  const iNum = idx(["car number", "number"]);

  const mappings = {};
  const entryList = [];
  const roster = [];

  for (const line of lines.slice(1)) {
    const cols = splitCsv(line);
    const username = iUser >= 0 ? cols[iUser] : "";
    const realName = iReal >= 0 ? cols[iReal] : "";
    const reg = iReg >= 0 ? cols[iReg] : "";
    if (!username) continue;
    entryList.push(username);
    roster.push({
      id: username,
      fullName: realName,
      registration: reg,
      carClass: iClass >= 0 ? cols[iClass] : "",
      car: iCar >= 0 ? cols[iCar] : "",
      carNum: iNum >= 0 ? cols[iNum] : null,
    });
    addMapping(mappings, username, username);
    if (realName) {
      addMapping(mappings, realName, username);
      // część przed | lub /
      addMapping(mappings, realName.split(/[|/]/)[0], username);
    }
    if (reg) addMapping(mappings, reg, username);
  }

  return {
    mappings,
    entryList: [...new Set(entryList)],
    roster,
    source: "csv",
  };
}

function parseEntrylistUpload({ filename = "", text = "", json = null }) {
  const name = String(filename || "").toLowerCase();
  if (json != null && typeof json === "object") return parseJsonEntrylist(json);
  if (name.endsWith(".csv") || (!name.endsWith(".json") && text.includes("username,") && text.includes("\n"))) {
    return parseCsvEntrylist(text);
  }
  try {
    return parseJsonEntrylist(JSON.parse(text));
  } catch {
    return parseCsvEntrylist(text);
  }
}

function stripTeamSuffix(name) {
  return clean(name)
    .replace(/\s*[|/].*$/, "")
    .replace(/\s*[-–—]\s*(cart|qbr|jrtp|hrt|sfr|bpl)\b.*$/i, "")
    .replace(/\s+\b(cart|qbr|jrtp|hrt|sfr|bpl)\b.*$/i, "")
    .trim();
}

function resolveMappedId(inGameName, mappings) {
  const raw = clean(inGameName);
  if (!raw) return "";

  const stripped = stripTeamSuffix(raw);
  const candidates = [];
  const consider = (from) => {
    if (!from) return;
    const to = mappings[from];
    if (to) candidates.push(clean(to));
  };
  consider(raw);
  consider(stripped);

  const want = new Set([normalizeKey(raw), normalizeKey(stripped)].filter(Boolean));
  for (const [from, to] of Object.entries(mappings || {})) {
    if (want.has(normalizeKey(from))) candidates.push(clean(to));
    // CSV często ma "Imię Nazwisko | TEAM"
    if (want.has(normalizeKey(stripTeamSuffix(from)))) candidates.push(clean(to));
  }

  const uniq = [...new Set(candidates.filter(Boolean))];
  const usernameLike = uniq.find((id) => id !== raw && !/\s/.test(id) && !isPlatformId(id));
  if (usernameLike) return usernameLike;
  if (uniq[0]) return uniq[0];
  return raw;
}

module.exports = {
  parseEntrylistUpload,
  parseJsonEntrylist,
  parseCsvEntrylist,
  resolveMappedId,
  clean,
  normalizeKey,
};
