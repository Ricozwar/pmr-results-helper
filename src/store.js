"use strict";

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const resultsDir = path.join(__dirname, "..", "results");

const defaults = {
  settings: {
    udpPort: 7580,
    httpPort: 3847,
    points: [36, 33, 29, 27, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6],
    fastestLapBonus: 1,
    humansOnly: false,
    onlyFillTotalTimeOnLeadLap: true,
  },
  penalties: {},
  entrylistMeta: {
    loaded: false,
    csvCount: 0,
    jsonCount: 0,
    mergedCount: 0,
    uploadedAt: null,
  },
};

function ensureDir(dir = dataDir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureResultsDir() {
  ensureDir(resultsDir);
  return resultsDir;
}

function readJson(file, fallback) {
  const full = path.join(dataDir, file);
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(value, null, 2));
}

function writeText(file, value) {
  ensureDir();
  fs.writeFileSync(path.join(dataDir, file), String(value ?? ""), "utf8");
}

function readText(file, fallback = "") {
  const full = path.join(dataDir, file);
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return fallback;
  }
}

function loadAll() {
  ensureDir();
  ensureResultsDir();
  return {
    settings: { ...defaults.settings, ...readJson("settings.json", {}) },
    penalties: readJson("penalties.json", defaults.penalties),
    entrylistMeta: { ...defaults.entrylistMeta, ...readJson("entrylist-meta.json", {}) },
    entrylistCsv: readText("entrylist-csv.txt", ""),
    entrylistJson: readText("entrylist.json", ""),
  };
}

function clearEntrylistFiles() {
  writeText("entrylist-csv.txt", "");
  writeText("entrylist.json", "");
  writeJson("entrylist-meta.json", { ...defaults.entrylistMeta });
}

function listResultFiles() {
  ensureResultsDir();
  return fs
    .readdirSync(resultsDir)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .map((name) => {
      const full = path.join(resultsDir, name);
      const st = fs.statSync(full);
      return { name, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function writeResultFile(filename, contents) {
  ensureResultsDir();
  const safe = path.basename(String(filename || "results.csv"));
  const full = path.join(resultsDir, safe);
  fs.writeFileSync(full, contents, "utf8");
  return safe;
}

function readResultFile(filename) {
  ensureResultsDir();
  const safe = path.basename(String(filename || ""));
  const full = path.join(resultsDir, safe);
  if (!full.startsWith(resultsDir)) throw new Error("invalid path");
  return fs.readFileSync(full, "utf8");
}

module.exports = {
  loadAll,
  writeJson,
  writeText,
  readText,
  clearEntrylistFiles,
  ensureResultsDir,
  listResultFiles,
  writeResultFile,
  readResultFile,
  defaults,
  dataDir,
  resultsDir,
};
