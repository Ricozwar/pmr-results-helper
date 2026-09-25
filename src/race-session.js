"use strict";

const {
  normalizeSessionKind,
  shortFileLabel,
  uiSessionLabel,
} = require("./session-kind");

function validSeconds(value) {
  return Number.isFinite(value) && value > 0.5 && value < 24 * 3600;
}

function toMs(seconds) {
  if (!validSeconds(seconds)) return null;
  return Math.round(seconds * 1000);
}

function emptyDriver(vehicleId) {
  return {
    vehicleId,
    mpIndex: vehicleId,
    name: "",
    car: "",
    carClass: "",
    human: false,
    isPlayer: false,
    active: false,
    position: 0,
    currentLap: 0,
    completedLaps: 0,
    lapTimes: [],
    bestLapMs: null,
    lastLapMs: null,
    totalTimeMs: null,
    currentLapTime: 0,
    prevCurrentLapTime: 0,
    raceState: "invalid",
    seenRacing: false,
    finished: false,
    dq: false,
    inPits: false,
    lapProgress: 0,
  };
}

function cloneDriver(d) {
  return {
    ...d,
    lapTimes: Array.isArray(d.lapTimes) ? [...d.lapTimes] : [],
  };
}

class RaceSession {
  constructor() {
    this.segments = [];
    this.segmentSeq = 0;
    this.reset("init");
  }

  reset(reason = "manual") {
    this.drivers = new Map();
    this.track = "";
    this.trackVariation = "";
    this.sessionLabel = "";
    this.gameMode = "";
    this.sessionState = "inactive";
    this.gameState = "waiting";
    this.lapsInEvent = 0;
    this.timedSession = false;
    this.numParticipants = 0;
    this.startedAt = null;
    this.frozen = false;
    this.frozenAt = null;
    this.freezeReason = null;
    this.resetReason = reason;
    this.packetCounts = {};
    this.lastPacketAt = null;
    this.udpPackets = 0;
    this.segments = [];
    this.segmentSeq = 0;
    this.currentKind = null;
    // After archive, ignore participant spam until next active segment.
    this.acceptingDrivers = true;
    this.awaitingFinalize = false;
    this.preFinishHold = null;
  }

  notePacket(type) {
    this.udpPackets += 1;
    this.lastPacketAt = Date.now();
    this.packetCounts[type] = (this.packetCounts[type] || 0) + 1;
  }

  getDriver(vehicleId) {
    if (!this.drivers.has(vehicleId)) this.drivers.set(vehicleId, emptyDriver(vehicleId));
    return this.drivers.get(vehicleId);
  }

  hasLiveDrivers() {
    for (const d of this.drivers.values()) {
      if (d.name || d.seenRacing || d.active) return true;
    }
    return false;
  }

  liveDriversList() {
    return [...this.drivers.values()]
      .filter((d) => d.name || d.seenRacing || d.active)
      .sort((a, b) => {
        if (a.position && b.position) return a.position - b.position;
        if (a.position) return -1;
        if (b.position) return 1;
        return a.vehicleId - b.vehicleId;
      })
      .map(cloneDriver);
  }

  /** Fill missing lap/total from best / current before snapshotting a segment. */
  finalizeDriverTimes(driver, { includeOpenLap = false } = {}) {
    if (!(driver.name || driver.seenRacing || driver.active)) return;

    const fromPrev = toMs(driver.prevCurrentLapTime);
    const fromCur = toMs(driver.currentLapTime);
    const fromBest = driver.bestLapMs;

    if (!driver.lapTimes.length) {
      const rem = fromPrev || fromCur || fromBest;
      if (rem) {
        driver.lapTimes.push(rem);
        driver.lastLapMs = rem;
      }
    }

    // 1-lap race: often finish flag arrives with empty currentLapTime but bestLap set.
    if (driver.lapTimes.length === 0 && fromBest) {
      driver.lapTimes.push(fromBest);
      driver.lastLapMs = fromBest;
    }

    if (includeOpenLap) {
      const openLap = fromPrev || fromCur;
      const expected =
        this.lapsInEvent > 0 ? this.lapsInEvent : Math.max(driver.completedLaps || 0, driver.lapTimes.length) + 1;
      if (openLap && driver.lapTimes.length < expected) {
        if (driver.lapTimes[driver.lapTimes.length - 1] !== openLap) {
          driver.lapTimes.push(openLap);
          driver.lastLapMs = openLap;
        }
      } else if (openLap && !driver.lapTimes.length) {
        driver.lapTimes.push(openLap);
        driver.lastLapMs = openLap;
      }
    }

    if (fromBest) {
      driver.bestLapMs = driver.bestLapMs ? Math.min(driver.bestLapMs, fromBest) : fromBest;
    } else if (driver.lapTimes.length) {
      driver.bestLapMs = Math.min(...driver.lapTimes);
    }

    if (driver.completedLaps < driver.lapTimes.length) {
      driver.completedLaps = driver.lapTimes.length;
    }
    if (driver.completedLaps === 0 && (driver.finished || driver.lapTimes.length)) {
      driver.completedLaps = Math.max(1, driver.lapTimes.length);
    }

    driver.totalTimeMs = driver.lapTimes.length
      ? driver.lapTimes.reduce((sum, t) => sum + t, 0)
      : fromBest || null;
  }

  finalizeDriversBeforeArchive(driversIterable = null, opts = {}) {
    const list = driversIterable || this.drivers.values();
    for (const driver of list) {
      this.finalizeDriverTimes(driver, opts);
    }
  }

  clearPreFinishHold() {
    this.preFinishHold = null;
  }

  anyDriverFinished() {
    for (const d of this.drivers.values()) {
      if (d.finished || d.dq) return true;
    }
    return false;
  }

  findLeader() {
    let leader = null;
    for (const d of this.drivers.values()) {
      if (!(d.name || d.seenRacing || d.active)) continue;
      if (!leader || (d.position > 0 && (leader.position === 0 || d.position < leader.position))) {
        leader = d;
      }
    }
    return leader;
  }

  isLeaderNearFinish(leader) {
    if (!leader || leader.finished || leader.dq) return false;
    const progress = Number(leader.lapProgress) || 0;
    if (progress < 0.92) return false;
    if (this.lapsInEvent > 0) {
      return (leader.currentLap || 0) >= this.lapsInEvent;
    }
    // Timed race: high progress alone is not enough; rely on sessionFinished lock.
    return false;
  }

  /** Clone live field into pre-finish hold (optionally locking). */
  refreshPreFinishHold({ lock = false, reason = "rolling" } = {}) {
    if (this.currentKind !== "race") return;
    if (this.preFinishHold?.locked && !lock) return;
    if (!this.hasLiveDrivers()) return;

    const drivers = this.liveDriversList();
    const leader = drivers.find((d) => d.position === 1) || drivers[0];
    this.finalizeDriversBeforeArchive(drivers, {
      includeOpenLap: Boolean(leader && this.isLeaderNearFinish(leader)),
    });
    // Recompute totals after finalize on clones
    for (const d of drivers) {
      if (d.lapTimes.length) {
        d.totalTimeMs = d.lapTimes.reduce((sum, t) => sum + t, 0);
        d.completedLaps = Math.max(d.completedLaps || 0, d.lapTimes.length);
        d.bestLapMs = Math.min(...d.lapTimes);
      }
    }

    this.preFinishHold = {
      capturedAt: Date.now(),
      locked: Boolean(lock || this.preFinishHold?.locked),
      reason: lock ? reason : this.preFinishHold?.locked ? this.preFinishHold.reason : reason,
      drivers,
    };
  }

  lockPreFinishHold(reason) {
    this.refreshPreFinishHold({ lock: true, reason });
    if (this.preFinishHold) this.preFinishHold.locked = true;
  }

  /** Manual / automatic lock of standings before the leader finishes. */
  snapshotStandings(reason = "manual") {
    if (this.currentKind !== "race") {
      throw new Error("Pre-finish snapshot is only available during race");
    }
    if (!this.hasLiveDrivers()) {
      throw new Error("No live race standings to save");
    }
    this.lockPreFinishHold(reason);
    return this.preFinishHold;
  }

  maybeUpdatePreFinishHold(parsed) {
    if (this.currentKind !== "race") return;
    if (this.preFinishHold?.locked) return;

    if (this.anyDriverFinished()) {
      // Keep previous clean hold; do not refresh from potentially corrupt live map.
      if (this.preFinishHold?.drivers?.length) {
        this.preFinishHold.locked = true;
        if (!this.preFinishHold.reason || this.preFinishHold.reason === "rolling") {
          this.preFinishHold.reason = "first_finished";
        }
      }
      return;
    }

    this.refreshPreFinishHold({ lock: false, reason: "rolling" });

    const leader =
      parsed?.racePos === 1
        ? this.drivers.get(parsed.vehicleId)
        : this.findLeader();
    if (leader && this.isLeaderNearFinish(leader)) {
      this.lockPreFinishHold("leader_near_finish");
    }
  }

  archiveLive(reason, penalties = {}) {
    if (!this.acceptingDrivers && !this.awaitingFinalize && !this.hasLiveDrivers()) return null;
    if (!this.hasLiveDrivers() && !(this.preFinishHold?.drivers?.length)) {
      this.acceptingDrivers = false;
      this.awaitingFinalize = false;
      return null;
    }

    const kind = normalizeSessionKind(this.sessionLabel);
    let drivers;
    let captureSource = "live";
    let capturedAt = Date.now();

    if (kind === "race" && this.preFinishHold?.drivers?.length) {
      drivers = this.preFinishHold.drivers.map(cloneDriver);
      this.finalizeDriversBeforeArchive(drivers, { includeOpenLap: true });
      captureSource = "pre_finish";
      capturedAt = this.preFinishHold.capturedAt || capturedAt;
    } else {
      this.finalizeDriversBeforeArchive();
      drivers = this.liveDriversList();
    }

    if (!drivers.length) {
      this.acceptingDrivers = false;
      this.awaitingFinalize = false;
      this.clearPreFinishHold();
      return null;
    }

    const segment = {
      id: `seg-${++this.segmentSeq}`,
      kind,
      label: this.sessionLabel || uiSessionLabel(kind),
      shortLabel: shortFileLabel(kind, this.sessionLabel),
      uiLabel: uiSessionLabel(kind, this.sessionLabel),
      track: this.track,
      trackVariation: this.trackVariation,
      gameMode: this.gameMode,
      frozenAt: Date.now(),
      freezeReason: reason,
      captureSource,
      capturedAt,
      drivers,
      penalties: { ...(penalties || {}) },
      csvFile: null,
      lapsCsvFile: null,
    };
    this.segments.push(segment);
    this.drivers = new Map();
    this.startedAt = null;
    this.frozen = false;
    this.frozenAt = null;
    this.freezeReason = null;
    this.acceptingDrivers = false;
    this.awaitingFinalize = false;
    this.clearPreFinishHold();
    return segment;
  }

  ingest(parsed, opts = {}) {
    if (!parsed || !parsed.type) return [];
    this.notePacket(parsed.type);
    const penalties = opts.penalties || {};

    if (this.frozen && parsed.type === "participantState" && !this.awaitingFinalize) return [];

    const archived = [];
    switch (parsed.type) {
      case "raceInfo":
        archived.push(...this.applyRaceInfo(parsed, penalties));
        break;
      case "participantState":
        this.applyParticipant(parsed);
        // After chequered flag, finalize once we see finished drivers (not merely best lap).
        if (this.awaitingFinalize) {
          const anyFinished = [...this.drivers.values()].some((d) => d.finished || d.dq);
          if (anyFinished) {
            const seg = this.archiveLive("session_complete_finalized", penalties);
            if (seg) archived.push(seg);
          }
        }
        break;
      case "sessionStopped": {
        const seg = this.archiveLive("session_stopped", penalties);
        if (seg) archived.push(seg);
        break;
      }
      default:
        break;
    }
    return archived;
  }

  hasUsableResult() {
    for (const d of this.drivers.values()) {
      if (!(d.name || d.seenRacing || d.active)) continue;
      if (d.finished || d.dq) return true;
      if (d.bestLapMs || d.lapTimes.length || toMs(d.prevCurrentLapTime) || toMs(d.currentLapTime)) {
        return true;
      }
    }
    return false;
  }

  applyRaceInfo(parsed, penalties = {}) {
    const archived = [];
    const incomingLabel =
      parsed.session != null && parsed.session !== "" ? parsed.session : this.sessionLabel;
    const incomingKind = normalizeSessionKind(incomingLabel);
    const previousKind = normalizeSessionKind(this.sessionLabel);

    if (
      incomingLabel &&
      this.sessionLabel &&
      incomingKind !== previousKind &&
      this.hasLiveDrivers()
    ) {
      const seg = this.archiveLive("session_kind_change", penalties);
      if (seg) archived.push(seg);
    }

    if (parsed.track) this.track = parsed.track;
    if (parsed.layout) this.trackVariation = parsed.layout;
    if (parsed.session) this.sessionLabel = parsed.session;
    if (parsed.gameMode) this.gameMode = parsed.gameMode;
    if (parsed.numParticipants != null) this.numParticipants = parsed.numParticipants;
    if (parsed.isLaps != null) this.timedSession = !parsed.isLaps;
    if (parsed.duration > 0 && parsed.isLaps) this.lapsInEvent = Math.round(parsed.duration);

    this.currentKind = normalizeSessionKind(this.sessionLabel);

    const previous = this.sessionState;
    if (parsed.sessionState) this.sessionState = parsed.sessionState;
    this.gameState = parsed.sessionState === "inactive" ? "menu" : "playing";

    if (parsed.sessionState === "active") {
      this.acceptingDrivers = true;
      this.awaitingFinalize = false;
      if (!this.startedAt) this.startedAt = Date.now();
      // New active race segment — clear stale pre-finish hold from previous race.
      if (this.currentKind === "race" && !this.hasLiveDrivers()) {
        this.clearPreFinishHold();
      }
    }

    // Do NOT archive on complete immediately — wait for finish packets / stopped / inactive.
    // That avoids empty Race totals on 1-lap sessions and duplicate weak segments.
    if (previous === "active" && parsed.sessionState === "complete") {
      this.awaitingFinalize = true;
      this.finalizeDriversBeforeArchive();
      if (this.hasUsableResult()) {
        // Only archive now if we already have finished drivers / times.
        const anyFinished = [...this.drivers.values()].some((d) => d.finished || d.dq);
        if (anyFinished) {
          const seg = this.archiveLive("session_complete", penalties);
          if (seg) archived.push(seg);
        }
      }
    } else if (
      previous !== "inactive" &&
      parsed.sessionState === "inactive" &&
      this.hasLiveDrivers()
    ) {
      const seg = this.archiveLive("session_inactive", penalties);
      if (seg) archived.push(seg);
    }

    return archived;
  }

  applyParticipant(parsed) {
    if (!this.acceptingDrivers && !this.awaitingFinalize) return;
    if (!parsed.driverName && !parsed.vehicleName && parsed.vehicleId === 0) return;

    const driver = this.getDriver(parsed.vehicleId);
    if (parsed.driverName) driver.name = parsed.driverName;
    if (parsed.vehicleName) driver.car = parsed.vehicleName;
    if (parsed.vehicleClass) driver.carClass = parsed.vehicleClass;
    driver.isPlayer = Boolean(parsed.isPlayer);
    driver.human = true;
    driver.active = true;
    driver.position = parsed.racePos || 0;
    driver.inPits = Boolean(parsed.inPits);
    driver.dq = Boolean(parsed.dq);
    driver.currentLapTime = parsed.currentLapTime || 0;
    if (parsed.lapProgress != null && Number.isFinite(parsed.lapProgress)) {
      driver.lapProgress = parsed.lapProgress;
    }

    const best = toMs(parsed.bestLapTime);
    if (best) driver.bestLapMs = driver.bestLapMs ? Math.min(driver.bestLapMs, best) : best;

    const lap = parsed.currentLap || 0;
    if (lap > driver.currentLap && driver.currentLap > 0) {
      const finishedLapMs = toMs(driver.prevCurrentLapTime);
      if (finishedLapMs) {
        driver.lapTimes.push(finishedLapMs);
        driver.lastLapMs = finishedLapMs;
      }
      driver.seenRacing = true;
      driver.raceState = "racing";
    } else if (lap > 0 || (parsed.currentLapTime || 0) > 1) {
      driver.seenRacing = true;
      driver.raceState = "racing";
    }

    // Keep last non-zero lap clock — finish packets often zero currentLapTime.
    if ((parsed.currentLapTime || 0) > 0.5) {
      driver.prevCurrentLapTime = parsed.currentLapTime;
    }
    driver.currentLap = lap;

    // Lock the last CLEAN standings before finish flags (often arrive with corrupt order).
    const finishingNow = Boolean(parsed.sessionFinished) || Boolean(parsed.dq);
    if (this.currentKind === "race" && finishingNow && !this.preFinishHold?.locked) {
      if (this.preFinishHold?.drivers?.length) {
        this.preFinishHold.locked = true;
        this.preFinishHold.reason = "pre_first_finished";
      } else {
        // No prior rolling hold — best effort clone before mutating this driver to finished.
        this.refreshPreFinishHold({ lock: true, reason: "pre_first_finished" });
      }
    }

    if (parsed.sessionFinished) {
      driver.finished = true;
      driver.raceState = "finished";
      const needLaps = Math.max(1, lap > 1 ? lap - 1 : 1);
      if (driver.lapTimes.length < needLaps) {
        const rem =
          toMs(driver.prevCurrentLapTime) ||
          toMs(parsed.currentLapTime) ||
          best ||
          driver.bestLapMs;
        if (rem && driver.lapTimes[driver.lapTimes.length - 1] !== rem) {
          driver.lapTimes.push(rem);
          driver.lastLapMs = rem;
        }
      }
    }

    if (parsed.dq) {
      driver.finished = true;
      driver.raceState = "dnf";
    }

    if (driver.finished) {
      driver.completedLaps = Math.max(driver.lapTimes.length, Math.max(0, lap > 0 ? lap - 1 : 0), 1);
    } else if (lap > 0) {
      driver.completedLaps = Math.max(driver.lapTimes.length, lap - 1);
    }
    driver.totalTimeMs = driver.lapTimes.length
      ? driver.lapTimes.reduce((sum, t) => sum + t, 0)
      : driver.bestLapMs || null;

    this.maybeUpdatePreFinishHold(parsed);
  }

  freeze(reason) {
    if (this.frozen) return;
    this.frozen = true;
    this.frozenAt = Date.now();
    this.freezeReason = reason;
  }

  unfreeze() {
    this.frozen = false;
    this.frozenAt = null;
    this.freezeReason = null;
  }

  snapshot() {
    const kind = normalizeSessionKind(this.sessionLabel);
    return {
      track: this.track,
      trackVariation: this.trackVariation,
      sessionState: this.sessionState,
      sessionLabel: this.sessionLabel,
      currentKind: kind,
      currentUiLabel: uiSessionLabel(kind, this.sessionLabel),
      gameMode: this.gameMode,
      gameState: this.gameState,
      lapsInEvent: this.lapsInEvent,
      timedSession: this.timedSession,
      numParticipants: this.numParticipants,
      startedAt: this.startedAt,
      frozen: this.frozen,
      frozenAt: this.frozenAt,
      freezeReason: this.freezeReason,
      preFinishHold: this.preFinishHold
        ? {
            capturedAt: this.preFinishHold.capturedAt,
            locked: Boolean(this.preFinishHold.locked),
            reason: this.preFinishHold.reason,
            driverCount: (this.preFinishHold.drivers || []).length,
          }
        : null,
      udpPackets: this.udpPackets,
      lastPacketAt: this.lastPacketAt,
      packetCounts: this.packetCounts,
      drivers: this.liveDriversList(),
      segments: this.segments.map((s) => ({
        ...s,
        drivers: (s.drivers || []).map(cloneDriver),
        penalties: { ...(s.penalties || {}) },
      })),
    };
  }
}

function buildSimgridJson(snapshot, options) {
  const mappings = options.mappings || {};
  const settings = options.settings || {};
  const entryList = options.entryList || [];
  const overrides = options.overrides || {};
  const points =
    settings.points || [36, 33, 29, 27, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];
  const fastestLapBonus = settings.fastestLapBonus ?? 1;
  const humansOnly = Boolean(settings.humansOnly);
  const leadLapOnlyTotalTime = settings.onlyFillTotalTimeOnLeadLap !== false;

  const liveDrivers = (snapshot.drivers || []).filter((d) => d.name || d.seenRacing || d.active);
  if (!liveDrivers.length) return [];

  const drivers = liveDrivers
    .filter((d) => (humansOnly ? d.human || Boolean(mappings[d.name]) : true))
    .map((d) => {
      const extra = overrides[String(d.vehicleId)] || overrides[d.name] || {};
      return {
        ...d,
        id: extra.id || mappings[d.name] || d.name,
        car: extra.car || d.car,
        carClass: extra.carClass || d.carClass || settings.defaultClass || "unknown",
        dnf: extra.dnf ?? (d.dq || d.raceState === "dnf"),
        dns: extra.dns ?? false,
        penaltyPoints: extra.penaltyPoints ?? null,
        carNum: extra.carNum ?? null,
      };
    });

  const presentIds = new Set(drivers.map((d) => d.id).filter(Boolean));
  for (const id of entryList) {
    if (!id || presentIds.has(id)) continue;
    drivers.push({
      vehicleId: `dns:${id}`,
      name: id,
      id,
      car: settings.defaultCar || "",
      carClass: settings.defaultClass || "unknown",
      position: 999,
      completedLaps: 0,
      bestLapMs: null,
      totalTimeMs: null,
      dnf: false,
      dns: true,
      human: true,
      penaltyPoints: null,
      carNum: null,
    });
  }

  function sortClass(list) {
    return list.sort((a, b) => {
      if (a.dns !== b.dns) return a.dns ? 1 : -1;
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      const posA = a.position || 999;
      const posB = b.position || 999;
      if (posA !== posB) return posA - posB;
      const lapsA = a.completedLaps || 0;
      const lapsB = b.completedLaps || 0;
      if (lapsA !== lapsB) return lapsB - lapsA;
      if (a.totalTimeMs && b.totalTimeMs) return a.totalTimeMs - b.totalTimeMs;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  const grouped = new Map();
  for (const driver of drivers) {
    const carClass = driver.carClass || settings.defaultClass || "unknown";
    if (!grouped.has(carClass)) grouped.set(carClass, []);
    grouped.get(carClass).push(driver);
  }

  const payload = [];
  for (const [carClass, list] of grouped.entries()) {
    const ordered = sortClass(list);
    const racing = ordered.filter((d) => !d.dns);
    const leaderLaps = racing.reduce((max, d) => Math.max(max, d.completedLaps || 0), 0);
    const bestLapOverall = racing
      .filter((d) => !d.dnf && d.bestLapMs)
      .reduce((best, d) => (!best || d.bestLapMs < best.bestLapMs ? d : best), null);

    const result = ordered.map((d, i) => {
      const position = d.dns ? i + 1 : d.position || i + 1;
      const pointsGiven = d.dns || d.dnf ? 0 : points[position - 1] || 0;
      const gotFastest =
        fastestLapBonus && bestLapOverall && d.id === bestLapOverall.id && !d.dns && !d.dnf;
      const pointTotal = pointsGiven + (gotFastest ? fastestLapBonus : 0);
      const onLeadLap = (d.completedLaps || 0) === leaderLaps && leaderLaps > 0;
      const totalTime =
        d.dns || d.dnf || (leadLapOnlyTotalTime && !onLeadLap) ? null : d.totalTimeMs;

      return {
        position,
        id: d.id || d.name || "",
        inGameName: d.name || "",
        carNum: d.carNum,
        car: d.car || settings.defaultCar || "",
        pointsGiven,
        penaltyPoints: d.penaltyPoints,
        pointTotal,
        totalLaps: d.dns ? null : d.completedLaps || null,
        bestLap: d.dns ? null : d.bestLapMs,
        totalTime,
        dnf: Boolean(d.dnf),
        dns: Boolean(d.dns),
      };
    });
    payload.push({ carClass, result });
  }

  return payload;
}

function stripExport(payload) {
  return (payload || []).map((group) => ({
    carClass: group.carClass,
    result: (group.result || []).map((row) => {
      const { inGameName, ...rest } = row;
      return rest;
    }),
  }));
}

module.exports = {
  RaceSession,
  buildSimgridJson,
  stripExport,
  toMs,
};
