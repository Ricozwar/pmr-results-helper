"use strict";

function normalizeSessionKind(label) {
  const s = String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!s) return "other";
  if (/(practice|training|trening|free\s*practice|\bfp\b)/.test(s)) return "practice";
  if (/(qualif|quali|kwalifik)/.test(s)) return "qualifying";
  if (/(^|\b)(race|wyscig|feature|sprint)(\b|$)/.test(s)) return "race";
  return "other";
}

function shortFileLabel(kind, rawLabel = "") {
  if (kind === "practice") return "Practice";
  if (kind === "qualifying") return "Quali";
  if (kind === "race") return "Race";
  const cleaned = String(rawLabel || "Session")
    .replace(/[^\w\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "Session";
}

function uiSessionLabel(kind, rawLabel = "") {
  if (kind === "practice") return "Trening";
  if (kind === "qualifying") return "Kwalifikacje";
  if (kind === "race") return "Wyścig";
  return String(rawLabel || "Sesja").trim() || "Sesja";
}

module.exports = {
  normalizeSessionKind,
  shortFileLabel,
  uiSessionLabel,
};
