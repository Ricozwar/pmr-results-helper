"use strict";

const { parsePacket } = require("./udp-parser");
const { RaceSession, buildSimgridJson, stripExport } = require("./race-session");
const {
  parseCsvEntrylist,
  parseJsonEntrylist,
  mergeEntrylist,
  buildSimgridRaceTable,
  formatRaceTime,
  raceTableToTsv,
  raceTableToSimgridJson,
} = require("./entrylist");

function lpString(s) {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from([b.length]), b]);
}

function lpFloats(arr) {
  const out = Buffer.alloc(1 + arr.length * 4);
  out[0] = arr.length;
  arr.forEach((v, i) => out.writeFloatLE(v, 1 + i * 4));
  return out;
}

function buildRaceInfo(sessionName = "Race", stateId = 1) {
  const parts = [
    Buffer.from([0]),
    Buffer.alloc(2),
    lpString("Daytona"),
    lpString("Road Course"),
    lpString("Dry"),
    lpString("Clear"),
    lpString(sessionName),
    lpString("Custom"),
    Buffer.alloc(20),
    Buffer.from([1, stateId, 2]),
  ];
  parts[1].writeUInt16LE(1, 0);
  parts[8].writeFloatLE(5000, 0);
  parts[8].writeFloatLE(10, 4);
  parts[8].writeFloatLE(0, 8);
  parts[8].writeFloatLE(22, 12);
  parts[8].writeFloatLE(30, 16);
  return Buffer.concat(parts);
}

function buildParticipant({ id, player, car, name, cls, pos, lap, cur, best, finished = 0, dq = 0 }) {
  const head = Buffer.alloc(1 + 2 + 4 + 1);
  head[0] = 1;
  head.writeUInt16LE(1, 1);
  head.writeInt32LE(id, 3);
  head[7] = player ? 1 : 0;
  const mid = Buffer.alloc(4 * 4 + 4 * 3);
  let o = 0;
  mid.writeInt32LE(pos, o); o += 4;
  mid.writeInt32LE(lap, o); o += 4;
  mid.writeFloatLE(cur, o); o += 4;
  mid.writeFloatLE(best, o); o += 4;
  mid.writeFloatLE(0.5, o); o += 4;
  mid.writeInt32LE(1, o);
  const tail = Buffer.from([0, finished, dq, 0, 0, 0, 0]);
  return Buffer.concat([
    head,
    lpString(car),
    lpString(name),
    lpString("liv"),
    lpString(cls),
    mid,
    lpFloats([30, 40, 35]),
    lpFloats([29, 39, 34]),
    tail,
  ]);
}

const race = parsePacket(buildRaceInfo());
if (race.track !== "Daytona" || race.sessionState !== "active") throw new Error("raceInfo parse failed");

const p = parsePacket(
  buildParticipant({
    id: 7,
    player: true,
    car: "Porsche 911 Carrera Cup (964)",
    name: "Ricozwar",
    cls: "964 trophy",
    pos: 1,
    lap: 3,
    cur: 50,
    best: 109.817,
  })
);
if (p.driverName !== "Ricozwar" || p.bestLapTime < 109) throw new Error("participant parse failed");

const session = new RaceSession();
session.ingest(race);
session.ingest(
  parsePacket(
    buildParticipant({
      id: 1,
      player: false,
      car: "MX-5 Spec",
      name: "Juan Martinez",
      cls: "MX5 Trophy",
      pos: 1,
      lap: 2,
      cur: 10,
      best: 141.201,
      finished: 1,
    })
  )
);
session.ingest(
  parsePacket(
    buildParticipant({
      id: 2,
      player: false,
      car: "MX-5 Spec",
      name: "Lucas Tanaka",
      cls: "MX5 Trophy",
      pos: 5,
      lap: 2,
      cur: 10,
      best: 139.728,
      finished: 1,
    })
  )
);
const snap = session.snapshot();
if (snap.drivers[0].name !== "Juan Martinez") throw new Error("snapshot should keep race order");
if (snap.drivers[0].position !== 1) throw new Error("P1 position");

const json = stripExport(
  buildSimgridJson(snap, {
    settings: { points: [36, 33, 29, 27, 26], fastestLapBonus: 1 },
  })
);
if (json[0].result[0].id !== "Juan Martinez") throw new Error("export must follow race position, not best lap");
if (json[0].result[0].position !== 1) throw new Error("P1 export");
if (json[0].result.find((r) => r.id === "Lucas Tanaka").pointTotal !== 26 + 1) {
  throw new Error("fastest lap bonus should stay with Tanaka at P5");
}
if (json[0].result[0].totalLaps !== 1) throw new Error(`expected 1 completed lap, got ${json[0].result[0].totalLaps}`);

const empty = stripExport(buildSimgridJson({ drivers: [] }, { entryList: ["x"], settings: {} }));
if (empty.length) throw new Error("empty must stay empty");

// --- lap times captured across lap increments ---
const lapSession = new RaceSession();
lapSession.ingest(race);
lapSession.ingest(
  parsePacket(
    buildParticipant({
      id: 9,
      player: true,
      car: "MX-5 Spec",
      name: "LapTester",
      cls: "MX5 Trophy",
      pos: 1,
      lap: 1,
      cur: 80.5,
      best: 0,
    })
  )
);
lapSession.ingest(
  parsePacket(
    buildParticipant({
      id: 9,
      player: true,
      car: "MX-5 Spec",
      name: "LapTester",
      cls: "MX5 Trophy",
      pos: 1,
      lap: 2,
      cur: 10,
      best: 80.5,
    })
  )
);
lapSession.ingest(
  parsePacket(
    buildParticipant({
      id: 9,
      player: true,
      car: "MX-5 Spec",
      name: "LapTester",
      cls: "MX5 Trophy",
      pos: 1,
      lap: 3,
      cur: 5,
      best: 79.2,
      finished: 1,
    })
  )
);
const lapSnap = lapSession.snapshot();
const lapDriver = lapSnap.drivers.find((d) => d.name === "LapTester");
if (!lapDriver?.lapTimes?.length) throw new Error("expected lapTimes on snapshot driver");
if (lapDriver.lapTimes[0] !== 80500) throw new Error(`lap1 expected 80500 got ${lapDriver.lapTimes[0]}`);

// --- entrylist match + penalties ---
const sampleCsv = `username,real name,identifier,username,platform,psn_username,steam64_id,steam_username,xbox_username,psn_id,xbox_id,car class,car name
thechecco14,thechecco14,username,thechecco14,psn,Francesco Esposito,,,,554371622505914562,,MX-5,Mazda MX-5 Spec
reincidente71,reincidente71,username,reincidente71,xbox,&quot;&quot;,&quot;&quot;,&quot;&quot;,reincidente71,,2533274839612553,MX-5,Mazda MX-5 Spec
ghost_dns,Ghost DNS,username,ghost_dns,steam,,,ghost_dns,,,MX-5,Mazda MX-5 Spec
`;

const sampleJson = JSON.stringify({
  entries: [
    {
      drivers: [
        {
          firstName: "Francesco ",
          lastName: "Esposito ",
          playerID: "P554371622505914562",
        },
      ],
    },
    {
      drivers: [
        {
          firstName: "Ulises ",
          lastName: "Navarro ",
          playerID: "M2533274839612553",
        },
      ],
    },
  ],
});

const csvRows = parseCsvEntrylist(sampleCsv);
if (csvRows.length !== 3) throw new Error(`csv rows expected 3 got ${csvRows.length}`);
if (csvRows[0].username !== "thechecco14") throw new Error("csv username");
if (csvRows[0].psnId !== "554371622505914562") throw new Error("csv psn id");

const jsonDrivers = parseJsonEntrylist(sampleJson);
if (jsonDrivers.length !== 2) throw new Error("json drivers");
if (jsonDrivers[0].playerIdBare !== "554371622505914562") throw new Error("strip P prefix");

const merged = mergeEntrylist(csvRows, jsonDrivers);
if (merged[0].fullName !== "Francesco Esposito") throw new Error("merge by psn id");
if (merged[1].fullName !== "Ulises Navarro") throw new Error("merge by xbox id");
if (!merged[0].aliases.includes("francesco esposito")) throw new Error("alias from json name");

const live = [
  {
    vehicleId: 10,
    inGameName: "Francesco Esposito",
    position: 1,
    totalLaps: 8,
    bestLap: 141201,
    totalTime: 1135000,
    dnf: false,
  },
  {
    vehicleId: 11,
    inGameName: "reincidente71",
    position: 2,
    totalLaps: 8,
    bestLap: 142000,
    totalTime: 1140000,
    dnf: false,
  },
  {
    vehicleId: 12,
    inGameName: "UnknownRacer",
    position: 3,
    totalLaps: 7,
    bestLap: 145000,
    totalTime: 1200000,
    dnf: false,
  },
];

const form = buildSimgridRaceTable(live, merged, { "11": 5 });
const p1 = form.find((r) => r.inGameName === "Francesco Esposito");
if (!p1 || p1.name !== "thechecco14") throw new Error("match psn username → SimGrid username");
if (p1.className !== "MX-5" || p1.car !== "Mazda MX-5 Spec") throw new Error("class/car from csv");

const p2 = form.find((r) => r.inGameName === "reincidente71");
if (!p2 || p2.name !== "reincidente71") throw new Error("match xbox username");
if (p2.penaltySec !== 5) throw new Error("penalty applied");
if (p2.totalTimeMs !== 1140000 + 5000) throw new Error("totalTime + penalty");
if (p2.position !== 2) throw new Error("penalty must not reorder positions");

const unmapped = form.find((r) => r.inGameName === "UnknownRacer");
if (!unmapped?.unmapped) throw new Error("unmapped live driver flagged");

const dns = form.find((r) => r.name === "ghost_dns");
if (!dns?.dns) throw new Error("unused csv entry becomes DNS");

if (formatRaceTime(65001) !== "1:05.001") throw new Error("format M:SS.mmm");
if (formatRaceTime(3661501) !== "1:01:01.501") throw new Error("format H:MM:SS.mmm");

const tsv = raceTableToTsv(form);
if (!tsv.startsWith("POS\tNAME\tCLASS")) throw new Error("tsv header");
if (!tsv.includes("thechecco14")) throw new Error("tsv has username");

const sg = raceTableToSimgridJson(form);
if (!sg[0]?.result?.some((r) => r.id === "thechecco14")) throw new Error("simgrid json id = username");

// --- multi-session archive + CSV naming ---
const {
  normalizeSessionKind,
  shortFileLabel,
  uiSessionLabel,
} = require("./session-kind");
const { buildSessionCsvRows, buildResultFilename } = require("./session-csv");

if (normalizeSessionKind("Practice") !== "practice") throw new Error("kind practice");
if (normalizeSessionKind("Qualifying") !== "qualifying") throw new Error("kind quali");
if (normalizeSessionKind("Race") !== "race") throw new Error("kind race");
if (uiSessionLabel("qualifying") !== "Qualifying") throw new Error("ui quali label");

const multi = new RaceSession();
multi.ingest(parsePacket(buildRaceInfo("Practice", 1)));
multi.ingest(
  parsePacket(
    buildParticipant({
      id: 1,
      player: true,
      car: "MX-5",
      name: "PracticeDriver",
      cls: "MX5",
      pos: 1,
      lap: 2,
      cur: 10,
      best: 90,
      finished: 1,
    })
  )
);
if (!multi.hasLiveDrivers()) throw new Error("practice should have drivers");
const archived = multi.ingest(parsePacket(buildRaceInfo("Qualifying", 1)));
if (archived.length !== 1) throw new Error(`expected 1 archived segment, got ${archived.length}`);
if (archived[0].kind !== "practice") throw new Error("archived should be practice");
if (archived[0].uiLabel !== "Practice") throw new Error("ui label Practice");
if (multi.segments.length !== 1) throw new Error("segments length");
if (multi.hasLiveDrivers()) throw new Error("live should be empty after kind change");
if (multi.sessionLabel !== "Qualifying") throw new Error("live label Qualifying");

const fname = buildResultFilename(archived[0], new Date(2026, 8, 21));
if (fname !== "Practice_Daytona_21.09.2026.csv") {
  throw new Error(`filename expected Practice_Daytona_21.09.2026.csv got ${fname}`);
}
const csvBody = buildSessionCsvRows(archived[0].drivers, {});
if (!csvBody.startsWith("P,In-game name,Car,Laps,Best,Time,Flag")) throw new Error("csv header");
if (!csvBody.includes("PracticeDriver")) throw new Error("csv body driver");

// --- no duplicate archive after complete + stopped; 1-lap race time from best ---
const raceOne = new RaceSession();
raceOne.ingest(parsePacket(buildRaceInfo("Race", 1)));
raceOne.ingest(
  parsePacket(
    buildParticipant({
      id: 3,
      player: true,
      car: "MX-5",
      name: "OneLap",
      cls: "MX5",
      pos: 1,
      lap: 1,
      cur: 145.2,
      best: 0,
    })
  )
);
// best appears, current may zero on finish packet (typical PMR)
raceOne.ingest(
  parsePacket(
    buildParticipant({
      id: 3,
      player: true,
      car: "MX-5",
      name: "OneLap",
      cls: "MX5",
      pos: 1,
      lap: 2,
      cur: 0,
      best: 145.2,
      finished: 1,
    })
  )
);
const closed = raceOne.ingest(parsePacket(buildRaceInfo("Race", 2))); // complete
// If not archived yet (waiting finalize), stop should archive once
let raceSegs = closed;
if (!raceSegs.length) {
  raceSegs = raceOne.ingest({ type: "sessionStopped", packetType: 3, packetVersion: 1 });
}
if (raceSegs.length !== 1) throw new Error(`race should archive once, got ${raceSegs.length}`);
const stoppedAgain = raceOne.ingest({ type: "sessionStopped", packetType: 3, packetVersion: 1 });
if (stoppedAgain.length !== 0) throw new Error("second stop must not duplicate segment");
if (raceOne.segments.length !== 1) throw new Error("only one race segment");
const one = raceSegs[0].drivers[0];
if (!one.totalTimeMs || one.totalTimeMs < 145000) {
  throw new Error(`1-lap race total missing/wrong: ${one.totalTimeMs}`);
}
if (!one.bestLapMs) throw new Error("1-lap race best missing");

// spam after archive must not create ghost second segment
raceOne.ingest(
  parsePacket(
    buildParticipant({
      id: 3,
      player: true,
      car: "MX-5",
      name: "OneLap",
      cls: "MX5",
      pos: 1,
      lap: 2,
      cur: 0,
      best: 145.2,
      finished: 1,
    })
  )
);
const inactiveDup = raceOne.ingest(parsePacket(buildRaceInfo("Race", 0)));
if (inactiveDup.length !== 0 || raceOne.segments.length !== 1) {
  throw new Error("post-archive spam created duplicate segment");
}

console.log("ok");
console.log(JSON.stringify({ entrylist: form.map((r) => ({ pos: r.position, name: r.name, dns: r.dns, unmapped: r.unmapped, pen: r.penaltySec })), legacy: json, multiFile: fname, raceTotal: one.totalTimeMs }, null, 2));
