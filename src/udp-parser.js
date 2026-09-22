"use strict";

/**
 * Native Project Motor Racing UDP (as used by SimHub GSIReader).
 * NOT Project CARS 2 / SMS protocol.
 *
 * Packet header: uint8 type, uint16LE version
 * Strings/arrays: uint8 length + payload (UTF-8 / float32 LE)
 *
 * Types:
 *   0 RaceInfo
 *   1 ParticipantRaceState
 *   2 ParticipantVehicleTelemetry (ignored for results)
 *   3 SessionStopped
 */

const PACKET = {
  RACE_INFO: 0,
  PARTICIPANT_STATE: 1,
  VEHICLE_TELEMETRY: 2,
  SESSION_STOPPED: 3,
};

const SESSION_STATE = {
  0: "inactive",
  1: "active",
  2: "complete",
};

function readLPString(buf, offset) {
  if (offset >= buf.length) return { value: "", next: offset };
  const len = buf[offset];
  const start = offset + 1;
  const end = start + len;
  if (end > buf.length) return { value: "", next: buf.length };
  return {
    value: buf.toString("utf8", start, end),
    next: end,
  };
}

function readLPFloatArray(buf, offset) {
  if (offset >= buf.length) return { value: [], next: offset };
  const len = buf[offset];
  let next = offset + 1;
  const value = [];
  for (let i = 0; i < len; i++) {
    if (next + 4 > buf.length) break;
    value.push(buf.readFloatLE(next));
    next += 4;
  }
  return { value, next };
}

function parseRaceInfo(buf) {
  if (buf.length < 3) return null;
  let o = 0;
  const packetType = buf[o++];
  const packetVersion = buf.readUInt16LE(o); o += 2;

  let track, layout, season, weather, session, gameMode;
  ({ value: track, next: o } = readLPString(buf, o));
  ({ value: layout, next: o } = readLPString(buf, o));
  ({ value: season, next: o } = readLPString(buf, o));
  ({ value: weather, next: o } = readLPString(buf, o));
  ({ value: session, next: o } = readLPString(buf, o));
  ({ value: gameMode, next: o } = readLPString(buf, o));

  if (o + 4 * 5 + 3 > buf.length) {
    return {
      type: "raceInfo",
      packetType,
      packetVersion,
      track,
      layout,
      season,
      weather,
      session,
      gameMode,
    };
  }

  const layoutLength = buf.readFloatLE(o); o += 4;
  const duration = buf.readFloatLE(o); o += 4;
  const overtime = buf.readFloatLE(o); o += 4;
  const ambientTemperature = buf.readFloatLE(o); o += 4;
  const trackTemperature = buf.readFloatLE(o); o += 4;
  const isLaps = buf[o++];
  const stateId = buf[o++];
  const numParticipants = buf[o++];

  return {
    type: "raceInfo",
    packetType,
    packetVersion,
    track,
    layout,
    season,
    weather,
    session,
    gameMode,
    layoutLength,
    duration,
    overtime,
    ambientTemperature,
    trackTemperature,
    isLaps: Boolean(isLaps),
    stateId,
    sessionState: SESSION_STATE[stateId] || String(stateId),
    numParticipants,
  };
}

function parseParticipantState(buf) {
  if (buf.length < 3) return null;
  let o = 0;
  const packetType = buf[o++];
  const packetVersion = buf.readUInt16LE(o); o += 2;
  if (o + 5 > buf.length) return null;

  const vehicleId = buf.readInt32LE(o); o += 4;
  const isPlayer = buf[o++] === 1;

  let vehicleName, driverName, liveryId, vehicleClass;
  ({ value: vehicleName, next: o } = readLPString(buf, o));
  ({ value: driverName, next: o } = readLPString(buf, o));
  ({ value: liveryId, next: o } = readLPString(buf, o));
  ({ value: vehicleClass, next: o } = readLPString(buf, o));

  if (o + 4 * 4 + 4 * 3 + 1 + 3 + 4 > buf.length) {
    // still return partial if we at least have identity
    return {
      type: "participantState",
      packetType,
      packetVersion,
      vehicleId,
      isPlayer,
      vehicleName,
      driverName,
      liveryId,
      vehicleClass,
      racePos: 0,
      currentLap: 0,
      currentLapTime: 0,
      bestLapTime: 0,
      lapProgress: 0,
      currentSector: 0,
      currentSectorTimes: [],
      bestSectorTimes: [],
      inPits: false,
      sessionFinished: false,
      dq: false,
      flags: 0,
    };
  }

  const racePos = buf.readInt32LE(o); o += 4;
  const currentLap = buf.readInt32LE(o); o += 4;
  const currentLapTime = buf.readFloatLE(o); o += 4;
  const bestLapTime = buf.readFloatLE(o); o += 4;
  const lapProgress = buf.readFloatLE(o); o += 4;
  const currentSector = buf.readInt32LE(o); o += 4;

  let currentSectorTimes, bestSectorTimes;
  ({ value: currentSectorTimes, next: o } = readLPFloatArray(buf, o));
  ({ value: bestSectorTimes, next: o } = readLPFloatArray(buf, o));

  const inPits = buf[o++] === 1;
  const sessionFinished = buf[o++] === 1;
  const dq = buf[o++] === 1;
  const flags = o + 4 <= buf.length ? buf.readUInt32LE(o) : 0;

  return {
    type: "participantState",
    packetType,
    packetVersion,
    vehicleId,
    isPlayer,
    vehicleName,
    driverName,
    liveryId,
    vehicleClass,
    racePos,
    currentLap,
    currentLapTime,
    bestLapTime,
    lapProgress,
    currentSector,
    currentSectorTimes,
    bestSectorTimes,
    inPits,
    sessionFinished,
    dq,
    flags,
  };
}

function parsePacket(buf) {
  if (!buf || buf.length < 3) return null;
  const packetType = buf[0];
  switch (packetType) {
    case PACKET.RACE_INFO:
      return parseRaceInfo(buf);
    case PACKET.PARTICIPANT_STATE:
      return parseParticipantState(buf);
    case PACKET.VEHICLE_TELEMETRY:
      return { type: "telemetry", packetType, packetVersion: buf.readUInt16LE(1), size: buf.length };
    case PACKET.SESSION_STOPPED:
      return { type: "sessionStopped", packetType, packetVersion: buf.readUInt16LE(1) };
    default:
      return { type: "unknown", packetType, size: buf.length };
  }
}

module.exports = {
  PACKET,
  SESSION_STATE,
  parsePacket,
  readLPString,
  parseRaceInfo,
  parseParticipantState,
};
