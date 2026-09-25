"use strict";

const { formatRaceTime } = require("./entrylist");
const { shortFileLabel } = require("./session-kind");

function sanitizePart(value) {
  return String(value || "Unknown")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-.\u00C0-\u024F]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "Unknown";
}

function formatDateLocal(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function flagForDriver(d) {
  if (d.dq || d.raceState === "dnf" || d.dnf) return "DNF";
  if (d.dns) return "DNS";
  if (d.finished || d.raceState === "finished") return "";
  return "";
}

function buildSessionCsvRows(drivers, penalties = {}) {
  const hasPenalty = Object.values(penalties || {}).some((v) => Number(v) > 0);
  const header = ["P", "In-game name", "Car", "Laps", "Best", "Time", "Flag"];
  if (hasPenalty) header.push("Penalty_s");

  const lines = [header.map(escapeCsv).join(",")];
  const list = [...(drivers || [])].sort((a, b) => {
    if (a.position && b.position) return a.position - b.position;
    if (a.position) return -1;
    if (b.position) return 1;
    return 0;
  });

  for (const d of list) {
    const key = String(d.vehicleId ?? d.name ?? "");
    const pen = Number(penalties[key] ?? penalties[d.name] ?? 0) || 0;
    const base = d.totalTimeMs;
    const total =
      base != null && Number.isFinite(base) ? base + Math.round(pen * 1000) : null;
    const row = [
      d.position || "",
      d.name || "",
      d.car || "",
      d.completedLaps ?? "",
      formatRaceTime(d.bestLapMs) || "",
      formatRaceTime(total) || "",
      flagForDriver(d),
    ];
    if (hasPenalty) row.push(pen || "");
    lines.push(row.map(escapeCsv).join(","));
  }
  return lines.join("\n") + "\n";
}

function buildSessionLapsCsvRows(drivers, penalties = {}) {
  const list = [...(drivers || [])].sort((a, b) => {
    if (a.position && b.position) return a.position - b.position;
    if (a.position) return -1;
    if (b.position) return 1;
    return 0;
  });
  const maxLaps = list.reduce(
    (max, d) => Math.max(max, Array.isArray(d.lapTimes) ? d.lapTimes.length : 0, d.completedLaps || 0),
    0
  );
  const hasPenalty = Object.values(penalties || {}).some((v) => Number(v) > 0);
  const header = ["P", "In-game name", "Car", "Laps", "Best", "Time", "Flag"];
  for (let i = 1; i <= maxLaps; i += 1) header.push(`Lap${i}`);
  if (hasPenalty) header.push("Penalty_s");

  const lines = [header.map(escapeCsv).join(",")];
  for (const d of list) {
    const key = String(d.vehicleId ?? d.name ?? "");
    const pen = Number(penalties[key] ?? penalties[d.name] ?? 0) || 0;
    const laps = Array.isArray(d.lapTimes) ? d.lapTimes : [];
    const base =
      d.totalTimeMs != null && Number.isFinite(d.totalTimeMs)
        ? d.totalTimeMs
        : laps.length
          ? laps.reduce((sum, t) => sum + t, 0)
          : null;
    const total =
      base != null && Number.isFinite(base) ? base + Math.round(pen * 1000) : null;
    const row = [
      d.position || "",
      d.name || "",
      d.car || "",
      d.completedLaps ?? laps.length ?? "",
      formatRaceTime(d.bestLapMs) || "",
      formatRaceTime(total) || "",
      flagForDriver(d),
    ];
    for (let i = 0; i < maxLaps; i += 1) {
      row.push(formatRaceTime(laps[i]) || "");
    }
    if (hasPenalty) row.push(pen || "");
    lines.push(row.map(escapeCsv).join(","));
  }
  return lines.join("\n") + "\n";
}

function buildResultFilename(segment, at = new Date()) {
  const short =
    segment.shortLabel ||
    shortFileLabel(segment.kind, segment.label);
  const track = sanitizePart(segment.track || "Unknown");
  const date = formatDateLocal(at);
  return `${short}_${track}_${date}.csv`;
}

function buildLapsResultFilename(segment, at = new Date()) {
  const base = buildResultFilename(segment, at).replace(/\.csv$/i, "");
  return `${base}_laps.csv`;
}

module.exports = {
  buildSessionCsvRows,
  buildSessionLapsCsvRows,
  buildResultFilename,
  buildLapsResultFilename,
  formatDateLocal,
  sanitizePart,
  escapeCsv,
};
