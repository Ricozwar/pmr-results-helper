"use strict";

function normalizeGenericLabel(rawLabel = "") {
  return String(rawLabel || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeSessionKind(label) {
  const s = normalizeGenericLabel(label);
  if (!s) return "other";
  if (/(practice|training|trening|free\s*practice|\bfp\b)/.test(s)) return "practice";
  if (/(qualif|quali|kwalifik)/.test(s)) return "qualifying";
  if (/(^|\b)(race|wyscig|feature|sprint)(\b|$)/.test(s)) return "race";
  return "other";
}

function isGenericSessionLabel(rawLabel = "") {
  const s = normalizeGenericLabel(rawLabel);
  return !s || s === "sesja" || s === "session";
}

function shortFileLabel(kind, rawLabel = "") {
  if (kind === "practice") return "Practice";
  if (kind === "qualifying") return "Quali";
  if (kind === "race") return "Race";
  const cleaned = String(isGenericSessionLabel(rawLabel) ? "Session" : rawLabel || "Session")
    .replace(/[^\w\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "Session";
}

function uiSessionLabel(kind, rawLabel = "") {
  if (kind === "practice") return "Practice";
  if (kind === "qualifying") return "Qualifying";
  if (kind === "race") return "Race";
  if (isGenericSessionLabel(rawLabel)) return "PMR Session";
  return String(rawLabel).trim();
}

module.exports = {
  normalizeSessionKind,
  shortFileLabel,
  uiSessionLabel,
};
