"use strict";

const dgram = require("dgram");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { parsePacket } = require("./udp-parser");
const { RaceSession, buildSimgridJson } = require("./race-session");
const { udpOccupants, describeOccupants } = require("./port-check");
const {
  parseCsvEntrylist,
  parseJsonEntrylist,
  mergeEntrylist,
  buildSimgridRaceTable,
  raceTableToTsv,
  raceTableToSimgridJson,
} = require("./entrylist");
const store = require("./store");
const { buildSessionCsvRows, buildResultFilename } = require("./session-csv");

const publicDir = path.join(__dirname, "..", "public");
const session = new RaceSession();
let state = store.loadAll();
let mergedEntrylist = [];
const sseClients = new Set();
let lastBroadcast = "";
let udp = null;
let udpBound = false;
let udpError = null;
let udpPort = Number(state.settings.udpPort) || 7580;
let udpOccupantInfo = [];

function persistArchivedSegments(segments) {
  if (!segments?.length) return;
  for (const seg of segments) {
    const csv = buildSessionCsvRows(seg.drivers, seg.penalties || {});
    const filename = buildResultFilename(seg, seg.frozenAt ? new Date(seg.frozenAt) : new Date());
    const saved = store.writeResultFile(filename, csv);
    seg.csvFile = saved;
    console.log(`Saved results: results/${saved}`);
  }
  // Kary należą do zarchiwizowanej części — nie przenoszą się na kolejną.
  state.penalties = {};
  store.writeJson("penalties.json", {});
}

function handleIngest(parsed) {
  const archived = session.ingest(parsed, { penalties: state.penalties || {} });
  if (archived.length) persistArchivedSegments(archived);
  return archived;
}

function reloadEntrylistFromState() {
  try {
    if (!state.entrylistCsv || !state.entrylistJson) {
      mergedEntrylist = [];
      return;
    }
    const csvRows = parseCsvEntrylist(state.entrylistCsv);
    const jsonDrivers = parseJsonEntrylist(state.entrylistJson);
    mergedEntrylist = mergeEntrylist(csvRows, jsonDrivers);
    state.entrylistMeta = {
      loaded: mergedEntrylist.length > 0,
      csvCount: csvRows.length,
      jsonCount: jsonDrivers.length,
      mergedCount: mergedEntrylist.length,
      uploadedAt: state.entrylistMeta?.uploadedAt || Date.now(),
    };
  } catch {
    mergedEntrylist = [];
  }
}

reloadEntrylistFromState();

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function udpStatus() {
  const others = udpOccupantInfo.filter((row) => !row.ours);
  return {
    port: udpPort,
    listening: Boolean(udpBound),
    error: udpError,
    occupants: udpOccupantInfo,
    occupiedBy: describeOccupants(udpOccupantInfo),
    occupiedByOther: others.length > 0,
    otherProcess: others[0] ? others[0].name : null,
  };
}

function liveRowsFromSnapshot(snapshot) {
  return (snapshot.drivers || []).map((d) => ({
    vehicleId: d.vehicleId,
    inGameName: d.name || "",
    name: d.name || "",
    car: d.car || "",
    carClass: d.carClass || "",
    position: d.position || 0,
    totalLaps: d.completedLaps || 0,
    completedLaps: d.completedLaps || 0,
    bestLap: d.bestLapMs,
    bestLapMs: d.bestLapMs,
    totalTime: d.totalTimeMs,
    totalTimeMs: d.totalTimeMs,
    dnf: Boolean(d.dq || d.raceState === "dnf"),
    dns: false,
  }));
}

function snapshotForExport() {
  const snap = session.snapshot();
  const raceSeg = [...(snap.segments || [])].reverse().find((s) => s.kind === "race");
  if (raceSeg?.drivers?.length) {
    return { snapshot: { ...snap, drivers: raceSeg.drivers, sessionLabel: raceSeg.label, track: raceSeg.track || snap.track, trackVariation: raceSeg.trackVariation || snap.trackVariation }, penalties: raceSeg.penalties || {} };
  }
  return { snapshot: snap, penalties: state.penalties || {} };
}

function buildRaceForm() {
  const { snapshot, penalties } = snapshotForExport();
  return buildSimgridRaceTable(liveRowsFromSnapshot(snapshot), mergedEntrylist, penalties);
}

function currentPayload() {
  const snapshot = session.snapshot();
  const raceForm = buildRaceForm();
  const legacy = buildSimgridJson(snapshot, {
    mappings: {},
    entryList: [],
    overrides: {},
    settings: state.settings,
  });
  return {
    ok: true,
    listening: Boolean(udpBound),
    udpError,
    udp: udpStatus(),
    snapshot,
    segments: snapshot.segments || [],
    penalties: state.penalties || {},
    entrylistMeta: state.entrylistMeta || store.defaults.entrylistMeta,
    raceForm,
    raceFormTsv: raceTableToTsv(raceForm),
    simgrid: raceTableToSimgridJson(raceForm),
    preview: legacy,
    settings: state.settings,
    results: store.listResultFiles(),
  };
}

function broadcast() {
  const payload = JSON.stringify(currentPayload());
  if (payload === lastBroadcast) return;
  lastBroadcast = payload;
  for (const client of sseClients) {
    client.write(`data: ${payload}\n\n`);
  }
}

function closeUdp() {
  return new Promise((resolve) => {
    if (!udp) {
      udpBound = false;
      return resolve();
    }
    const socket = udp;
    udp = null;
    udpBound = false;
    socket.removeAllListeners();
    socket.once("close", resolve);
    try {
      socket.close();
    } catch {
      resolve();
    }
  });
}

function attachUdp(socket) {
  socket.on("message", (msg) => {
    try {
      const parsed = parsePacket(msg);
      if (parsed) handleIngest(parsed);
    } catch (err) {
      udpError = String(err.message || err);
    }
  });
}

async function refreshOccupants(port = udpPort) {
  udpOccupantInfo = await udpOccupants(port);
  return udpOccupantInfo;
}

async function bindUdp(port) {
  const next = Number(port);
  if (!Number.isInteger(next) || next < 1024 || next > 65535) {
    throw new Error("UDP port must be a number between 1024 and 65535");
  }

  await closeUdp();
  const occupants = await udpOccupants(next);
  const others = occupants.filter((row) => !row.ours);
  if (others.length) {
    udpPort = next;
    udpError = `Port ${next} used by ${others.map((row) => row.name).join(", ")}`;
    udpOccupantInfo = occupants;
    udpBound = false;
    throw new Error(udpError);
  }

  await new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
    attachUdp(socket);
    const fail = (err) => {
      udpError = err.message || String(err);
      udpBound = false;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(err);
    };
    socket.once("error", fail);
    socket.bind({ port: next, address: "127.0.0.1", exclusive: true }, () => {
      socket.removeListener("error", fail);
      socket.on("error", (err) => {
        udpError = err.message;
        udpBound = false;
        broadcast();
      });
      udp = socket;
      udpPort = next;
      udpBound = true;
      udpError = null;
      resolve();
    });
  });

  udpOccupantInfo = await udpOccupants(next);
  console.log(`PMR UDP listening: 127.0.0.1:${next}`);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(publicDir, file);
  if (!full.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(full);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": `${types[ext] || "text/plain"}; charset=utf-8` });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      await refreshOccupants();
      return json(res, 200, currentPayload());
    }
    if (req.method === "GET" && url.pathname === "/api/port-check") {
      const port = Number(url.searchParams.get("port") || udpPort);
      const occupants = await udpOccupants(port);
      const others = occupants.filter((row) => !row.ours);
      return json(res, 200, {
        ok: true,
        port,
        occupants,
        occupiedBy: describeOccupants(occupants),
        occupiedByOther: others.length > 0,
        otherProcess: others[0] ? others[0].name : null,
        free: occupants.length === 0 || occupants.every((row) => row.ours),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(currentPayload())}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/export.json") {
      const form = buildRaceForm();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="simgrid-pmr-results.json"',
      });
      res.end(JSON.stringify(raceTableToSimgridJson(form), null, 2));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/export.tsv") {
      const form = buildRaceForm();
      res.writeHead(200, {
        "Content-Type": "text/tab-separated-values; charset=utf-8",
        "Content-Disposition": 'attachment; filename="simgrid-race-form.tsv"',
      });
      res.end(raceTableToTsv(form));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/results") {
      return json(res, 200, { ok: true, results: store.listResultFiles() });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/results/")) {
      const name = decodeURIComponent(url.pathname.slice("/api/results/".length));
      const body = store.readResultFile(name);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${path.basename(name)}"`,
      });
      res.end(body);
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/export-csv")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length, -"/export-csv".length));
      const snap = session.snapshot();
      const seg = (snap.segments || []).find((s) => s.id === id);
      if (!seg) throw new Error("Session segment not found");
      const csv = buildSessionCsvRows(seg.drivers, seg.penalties || {});
      const filename = seg.csvFile || buildResultFilename(seg, seg.frozenAt ? new Date(seg.frozenAt) : new Date());
      const saved = store.writeResultFile(filename, csv);
      seg.csvFile = saved;
      const liveSeg = session.segments.find((s) => s.id === id);
      if (liveSeg) liveSeg.csvFile = saved;
      broadcast();
      return json(res, 200, { ok: true, file: saved, results: store.listResultFiles() });
    }
    if (req.method === "POST" && url.pathname === "/api/entrylist") {
      const body = await readBody(req);
      const csvText = body.csv || body.csvText || "";
      const jsonText = body.json || body.jsonText || "";
      if (!csvText.trim() || !jsonText.trim()) {
        throw new Error("Upload both files: CSV and JSON entry lists");
      }
      const csvRows = parseCsvEntrylist(csvText);
      const jsonDrivers = parseJsonEntrylist(jsonText);
      if (!csvRows.length) throw new Error("CSV entry list contains no drivers");
      mergedEntrylist = mergeEntrylist(csvRows, jsonDrivers);
      state.entrylistCsv = csvText;
      state.entrylistJson = typeof jsonText === "string" ? jsonText : JSON.stringify(jsonText);
      state.entrylistMeta = {
        loaded: true,
        csvCount: csvRows.length,
        jsonCount: jsonDrivers.length,
        mergedCount: mergedEntrylist.length,
        uploadedAt: Date.now(),
      };
      store.writeText("entrylist-csv.txt", state.entrylistCsv);
      store.writeText("entrylist.json", state.entrylistJson);
      store.writeJson("entrylist-meta.json", state.entrylistMeta);
      broadcast();
      return json(res, 200, {
        ok: true,
        entrylistMeta: state.entrylistMeta,
        raceForm: buildRaceForm(),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/penalties") {
      const body = await readBody(req);
      const next = body.penalties || body;
      const cleaned = {};
      for (const [key, value] of Object.entries(next || {})) {
        const sec = Number(value);
        if (Number.isFinite(sec) && sec !== 0) cleaned[String(key)] = sec;
      }

      const segmentId = body.segmentId || null;
      if (segmentId) {
        const seg = session.segments.find((s) => s.id === segmentId);
        if (!seg) throw new Error("Segment not found");
        if (seg.kind !== "race") {
          throw new Error("Penalties can only be applied to the race session");
        }
        seg.penalties = cleaned;
        const csv = buildSessionCsvRows(seg.drivers, seg.penalties);
        const filename =
          seg.csvFile || buildResultFilename(seg, seg.frozenAt ? new Date(seg.frozenAt) : new Date());
        seg.csvFile = store.writeResultFile(filename, csv);
      } else {
        // Live race only
        const kind = session.currentKind || require("./session-kind").normalizeSessionKind(session.sessionLabel);
        if (kind !== "race") {
          throw new Error("Live penalties only during race (not practice/quali)");
        }
        state.penalties = cleaned;
        store.writeJson("penalties.json", state.penalties);
      }
      broadcast();
      return json(res, 200, currentPayload());
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      const body = await readBody(req);
      const prevPort = Number(state.settings.udpPort) || 7580;
      state.settings = { ...state.settings, ...body };
      if (body.udpPort != null) state.settings.udpPort = Number(body.udpPort);
      store.writeJson("settings.json", state.settings);
      if (body.udpPort != null && Number(body.udpPort) !== prevPort) {
        await bindUdp(state.settings.udpPort);
      } else {
        broadcast();
      }
      return json(res, 200, currentPayload());
    }
    if (req.method === "POST" && url.pathname === "/api/udp-port") {
      const body = await readBody(req);
      const next = Number(body.port ?? body.udpPort);
      state.settings.udpPort = next;
      store.writeJson("settings.json", state.settings);
      await bindUdp(next);
      return json(res, 200, currentPayload());
    }
    if (req.method === "POST" && url.pathname === "/api/freeze") {
      session.freeze("manual");
      broadcast();
      return json(res, 200, currentPayload());
    }
    if (req.method === "POST" && url.pathname === "/api/unfreeze") {
      session.unfreeze();
      broadcast();
      return json(res, 200, currentPayload());
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      session.reset("manual");
      state.penalties = {};
      store.writeJson("penalties.json", {});
      store.clearEntrylistFiles();
      state.entrylistCsv = "";
      state.entrylistJson = "";
      state.entrylistMeta = { ...store.defaults.entrylistMeta };
      mergedEntrylist = [];
      broadcast();
      return json(res, 200, currentPayload());
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/")) {
      return json(res, 404, { ok: false, error: "not_found" });
    }
    serveStatic(req, res);
  } catch (err) {
    json(res, 400, { ok: false, error: String(err.message || err), udp: udpStatus() });
  }
});

const httpPort = state.settings.httpPort || 3847;

server.listen(httpPort, "127.0.0.1", async () => {
  console.log(`PMR → SimGrid helper: http://127.0.0.1:${httpPort}`);
  try {
    await bindUdp(udpPort);
  } catch (err) {
    console.error(String(err.message || err));
    broadcast();
  }
});

setInterval(() => {
  refreshOccupants().then(broadcast).catch(() => broadcast());
}, 1500);
