const $ = (id) => document.getElementById(id);

let latestState = null;
let csvText = "";
let jsonText = "";
let draftPenalties = {};
/** @type {string|null} `${scope}:${vehicleId}` e.g. live:3 or seg-1:3 */
let expandedKey = null;
/** segment id when editing archived race penalties; null = live */
let penaltyTargetSegmentId = null;

function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
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

function udpHintText(state) {
  const udp = state.udp || {};
  const port = udp.port || state.settings?.udpPort || 7580;
  if (udp.occupiedByOther) {
    return `Port ${port} is used by ${udp.otherProcess}. Change the port here and in PMR.`;
  }
  if (udp.error) return udp.error;
  if (udp.listening) return `Listening on ${port}. In PMR: Host 127.0.0.1, Port ${port}.`;
  return `Port ${port}: set it and click Apply.`;
}

function updateBanner(state) {
  const snap = state.snapshot || {};
  const udp = state.udp || {};
  const banner = $("connBanner");
  const packets = snap.udpPackets || 0;
  const track = [snap.track, snap.trackVariation].filter(Boolean).join(" / ");

  if (udp.occupiedByOther || udp.error) {
    banner.className = "conn-banner bad";
    $("bannerTitle").textContent = "UDP port error";
    $("bannerDetail").textContent = udp.error || `Port used by ${udp.otherProcess}`;
    return;
  }
  if (udp.listening && packets > 0) {
    banner.className = "conn-banner ok";
    $("bannerTitle").textContent = "Connected to PMR";
    const sessionBit = snap.currentUiLabel || snap.sessionLabel || "";
    $("bannerDetail").textContent = `packets: ${packets}${track ? ` · track ${track}` : ""}${
      sessionBit ? ` · ${sessionBit}` : ""
    }`;
    return;
  }
  if (udp.listening) {
    banner.className = "conn-banner warn";
    $("bannerTitle").textContent = "UDP listening — no packets yet";
    $("bannerDetail").textContent = `Port ${udp.port}. Start a session in PMR.`;
    return;
  }
  banner.className = "conn-banner warn";
  $("bannerTitle").textContent = "UDP inactive";
  $("bannerDetail").textContent = "Set the port and click Apply.";
}

function lapDetailHtml(driver) {
  const laps = Array.isArray(driver.lapTimes) ? driver.lapTimes : [];
  if (!laps.length) {
    return `<p class="hint lap-empty">No lap times</p>`;
  }
  const best = laps.reduce((m, t) => (m == null || t < m ? t : m), null);
  const items = laps
    .map((ms, i) => {
      const isBest = best != null && ms === best;
      return `<li class="${isBest ? "best-lap" : ""}"><span class="lap-num">Lap ${i + 1}</span><span class="lap-time">${formatMs(ms)}</span>${
        isBest ? '<span class="lap-best-tag">best</span>' : ""
      }</li>`;
    })
    .join("");
  return `<ol class="lap-list">${items}</ol>`;
}

function driversTableHtml(drivers, penalties = {}, { clickable = false, scope = "live" } = {}) {
  if (!drivers?.length) {
    return `<p class="hint">No drivers in this session segment.</p>`;
  }
  const rows = drivers
    .map((d) => {
      const key = String(d.vehicleId);
      const rowKey = `${scope}:${key}`;
      const pen = Number(penalties[key] ?? penalties[d.name] ?? 0) || 0;
      const total =
        d.totalTimeMs != null && Number.isFinite(d.totalTimeMs)
          ? d.totalTimeMs + Math.round(pen * 1000)
          : null;
      const flag = d.dq || d.raceState === "dnf" ? "DNF" : "";
      const expanded = clickable && expandedKey === rowKey;
      const main = `<tr class="${clickable ? "driver-row" : ""} ${pen > 0 ? "has-penalty" : ""} ${
        expanded ? "expanded" : ""
      }" ${
        clickable
          ? `data-vid="${key}" data-scope="${scope}" title="Show lap times"`
          : ""
      }>
        <td>${d.position || "—"}</td>
        <td>${d.name || "—"}</td>
        <td>${d.car || "—"}</td>
        <td>${d.completedLaps ?? "—"}</td>
        <td>${formatMs(d.bestLapMs)}</td>
        <td>${formatMs(total)}${pen > 0 ? ` <span class="muted">(+${pen}s)</span>` : ""}</td>
        <td class="${flag ? "bad" : "muted"}">${flag}</td>
      </tr>`;
      if (!expanded) return main;
      return `${main}<tr class="lap-detail" data-for-vid="${key}"><td colspan="7">${lapDetailHtml(d)}</td></tr>`;
    })
    .join("");
  return `<table>
    <thead><tr>
      <th>P</th><th>In-game name</th><th>Car</th><th>Laps</th><th>Best</th><th>Time</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function bindDriverRowClicks(root) {
  root.querySelectorAll("tr.driver-row").forEach((tr) => {
    tr.addEventListener("click", () => {
      const vid = tr.dataset.vid;
      const scope = tr.dataset.scope || "live";
      const rowKey = `${scope}:${vid}`;
      expandedKey = expandedKey === rowKey ? null : rowKey;
      render(latestState);
    });
  });
}

function getRacePenaltyTarget(state) {
  const segments = state.segments || state.snapshot?.segments || [];
  const raceSeg = [...segments].reverse().find((s) => s.kind === "race" && s.drivers?.length);
  const snap = state.snapshot || {};
  const liveIsRace =
    (snap.currentKind === "race" || /race|wyścig|wyscig/i.test(snap.sessionLabel || "")) &&
    (snap.drivers || []).length;
  if (raceSeg) {
    return { segmentId: raceSeg.id, drivers: raceSeg.drivers, penalties: raceSeg.penalties || {}, label: raceSeg.uiLabel || "Race" };
  }
  if (liveIsRace) {
    return {
      segmentId: null,
      drivers: snap.drivers,
      penalties: state.penalties || {},
      label: snap.currentUiLabel || "Race (live)",
    };
  }
  return null;
}

function renderSegments(state) {
  const host = $("segmentsHost");
  const segments = state.segments || state.snapshot?.segments || [];
  if (!segments.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = segments
    .map((seg) => {
      const track = [seg.track, seg.trackVariation].filter(Boolean).join(" / ") || "—";
      const file = seg.csvFile
        ? `<a class="btn-link" href="/api/results/${encodeURIComponent(seg.csvFile)}" download>${seg.csvFile}</a>`
        : `<button type="button" class="ghost export-seg" data-seg-id="${seg.id}">Save / Download CSV</button>`;
      const penBtn =
        seg.kind === "race"
          ? `<button type="button" class="ghost race-penalties-btn" data-seg-id="${seg.id}">Penalties</button>`
          : "";
      return `<section class="card table-card segment-card" data-seg="${seg.id}">
        <div class="card-head">
          <div>
            <h2>${seg.uiLabel || seg.label || "Session"}</h2>
            <p class="hint">Track: ${track} · saved · ${seg.csvFile ? "CSV OK" : "CSV pending"} · click row = laps</p>
          </div>
          <div class="segment-actions">${penBtn}${file}</div>
        </div>
        ${driversTableHtml(seg.drivers, seg.penalties || {}, { clickable: true, scope: seg.id })}
      </section>`;
    })
    .join("");

  bindDriverRowClicks(host);

  host.querySelectorAll(".export-seg").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.segId;
      try {
        const data = await post(`/api/sessions/${encodeURIComponent(id)}/export-csv`);
        if (data.file) {
          window.location.href = `/api/results/${encodeURIComponent(data.file)}`;
        }
        const fresh = await fetch("/api/state").then((r) => r.json());
        render(fresh);
      } catch (err) {
        btn.textContent = String(err.message || err);
      }
    });
  });

  host.querySelectorAll(".race-penalties-btn").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openPenaltiesForSegment(btn.dataset.segId);
    });
  });
}

function renderLiveTable(state) {
  const snap = state.snapshot || {};
  const drivers = snap.drivers || [];
  const penalties = state.penalties || {};
  const host = $("liveTable");
  const title = snap.currentUiLabel || snap.sessionLabel || "PMR Session";
  $("liveTitle").textContent = `${title} · live`;
  $("trackLabel").textContent = `Track: ${[snap.track, snap.trackVariation].filter(Boolean).join(" / ") || "—"} · ${
    snap.frozen ? "STOP UDP" : "live"
  } · ${snap.sessionState || "—"} · click row = laps`;

  if (!drivers.length) {
    const port = state.udp?.port || state.settings?.udpPort || 7580;
    host.innerHTML = `<p class="hint">${
      state.udp?.listening
        ? `Waiting for session data. PMR → 127.0.0.1:${port}. Practice / Quali / Race appear automatically.`
        : `Set the UDP port first and click Apply.`
    }</p>`;
    return;
  }

  host.innerHTML = driversTableHtml(drivers, penalties, { clickable: true, scope: "live" });
  bindDriverRowClicks(host);
}

function renderRaceFormTable(rows) {
  const host = $("raceFormTable");
  if (!rows?.length) {
    host.innerHTML = `<p class="hint">No rows — upload the entry list and capture a race result.</p>`;
    return;
  }
  host.innerHTML = `<table>
    <thead><tr>
      <th>POS</th><th>NAME</th><th>CLASS</th><th>#</th><th>CAR</th>
      <th>LAPS</th><th>BEST LAP</th><th>TOTAL TIME</th><th>DNF</th><th>DNS</th>
    </tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr class="${r.penaltySec > 0 ? "has-penalty" : ""} ${r.unmapped ? "bad" : ""}">
      <td>${r.position}</td>
      <td class="${r.unmapped ? "unmapped-name" : ""}">${r.name || r.inGameName || "⚠ unmapped"}</td>
      <td>${r.className || ""}</td>
      <td>${r.carNum ?? ""}</td>
      <td>${r.car || ""}</td>
      <td>${r.laps ?? ""}</td>
      <td>${formatMs(r.bestLapMs)}</td>
      <td>${formatMs(r.totalTimeMs)}</td>
      <td>${r.dnf ? "X" : ""}</td>
      <td>${r.dns ? "X" : ""}</td>
    </tr>`
      )
      .join("")}</tbody>
  </table>`;
}

function renderPenaltiesTable(target) {
  const drivers = target?.drivers || [];
  const penalties = { ...(target?.penalties || {}), ...draftPenalties };
  const host = $("penaltiesTable");
  const title = $("penaltiesForm")?.querySelector("h2");
  if (title) title.textContent = `Penalties — ${target?.label || "Race"}`;
  if (!drivers.length) {
    host.innerHTML = `<p class="hint">No race field to apply penalties to.</p>`;
    return;
  }
  host.innerHTML = `<table>
    <thead><tr>
      <th>POS</th><th>Name</th><th>Time</th><th>Penalty (s)</th><th>After</th>
    </tr></thead>
    <tbody>${drivers
      .map((d) => {
        const key = String(d.vehicleId);
        const pen = Number(penalties[key] ?? 0) || 0;
        const base = d.totalTimeMs;
        const after =
          base != null && Number.isFinite(base) ? base + Math.round(pen * 1000) : null;
        return `<tr class="${pen > 0 ? "has-penalty" : ""}" data-vid="${key}">
          <td>${d.position || "—"}</td>
          <td>${d.name || "—"}</td>
          <td>${formatMs(base)}</td>
          <td><input class="penalty-input" type="number" step="0.1" min="0" data-vid="${key}" value="${pen || ""}" /></td>
          <td class="after-time">${formatMs(after)}</td>
        </tr>`;
      })
      .join("")}</tbody>
  </table>`;

  host.querySelectorAll(".penalty-input").forEach((input) => {
    input.addEventListener("input", () => {
      const vid = input.dataset.vid;
      const sec = Number(input.value) || 0;
      draftPenalties[vid] = sec;
      const row = input.closest("tr");
      const driver = drivers.find((d) => String(d.vehicleId) === vid);
      const base = driver?.totalTimeMs;
      const after =
        base != null && Number.isFinite(base) ? base + Math.round(sec * 1000) : null;
      row.querySelector(".after-time").textContent = formatMs(after);
      row.classList.toggle("has-penalty", sec > 0);
    });
  });
}

function openPenaltiesForSegment(segmentId) {
  const state = latestState;
  const segments = state?.segments || state?.snapshot?.segments || [];
  const seg = segments.find((s) => s.id === segmentId && s.kind === "race");
  if (!seg) return;
  penaltyTargetSegmentId = seg.id;
  draftPenalties = { ...(seg.penalties || {}) };
  renderPenaltiesTable({
    segmentId: seg.id,
    drivers: seg.drivers,
    penalties: seg.penalties || {},
    label: seg.uiLabel || "Race",
  });
  $("penaltiesModal").showModal();
}

function openPenaltiesDefault() {
  const target = getRacePenaltyTarget(latestState || {});
  if (!target) return;
  penaltyTargetSegmentId = target.segmentId;
  draftPenalties = { ...(target.penalties || {}) };
  renderPenaltiesTable(target);
  $("penaltiesModal").showModal();
}

function render(state) {
  latestState = state;
  const snap = state.snapshot || {};
  updateBanner(state);
  const hint = $("udpHint");
  hint.textContent = udpHintText(state);
  const udp = state.udp || {};
  hint.className = `hint ${
    udp.listening && !udp.error && !udp.occupiedByOther ? "ok" : udp.error || udp.occupiedByOther ? "bad" : ""
  }`;
  if (document.activeElement !== $("udpPort")) {
    $("udpPort").value = udp.port || state.settings?.udpPort || 7580;
  }

  const frozen = Boolean(snap.frozen);
  $("stopUdpBtn").textContent = frozen ? "Resume UDP" : "Stop UDP";
  $("penaltiesBtn").disabled = !getRacePenaltyTarget(state);

  renderSegments(state);
  renderLiveTable(state);

  if (state.entrylistMeta?.loaded) {
    $("uploadMeta").textContent = `Loaded ${state.entrylistMeta.mergedCount} drivers (CSV ${state.entrylistMeta.csvCount}, JSON ${state.entrylistMeta.jsonCount}).`;
  }

  if (!$("generateStep2").hidden) {
    renderRaceFormTable(state.raceForm || []);
    const meta = state.entrylistMeta || {};
    $("generateMeta").textContent = meta.loaded
      ? `${meta.mergedCount} drivers from entry list · ${state.raceForm?.length || 0} form rows`
      : "No entry list — go back and upload the files.";
  }
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

$("stopUdpBtn").onclick = async () => {
  const frozen = latestState?.snapshot?.frozen;
  const data = await post(frozen ? "/api/unfreeze" : "/api/freeze");
  render(data);
};

$("penaltiesBtn").onclick = () => openPenaltiesDefault();

$("penaltiesForm").onsubmit = async (ev) => {
  if (ev.submitter?.value !== "apply") return;
  ev.preventDefault();
  const penalties = {};
  $("penaltiesTable")
    .querySelectorAll(".penalty-input")
    .forEach((input) => {
      const sec = Number(input.value);
      if (Number.isFinite(sec) && sec !== 0) penalties[input.dataset.vid] = sec;
    });
  const body = { penalties };
  if (penaltyTargetSegmentId) body.segmentId = penaltyTargetSegmentId;
  const data = await post("/api/penalties", body);
  draftPenalties = {};
  penaltyTargetSegmentId = null;
  $("penaltiesModal").close();
  render(data);
};

$("generateBtn").onclick = () => {
  $("generateStep1").hidden = false;
  $("generateStep2").hidden = true;
  $("copyState").textContent = "";
  const ready = Boolean(csvText && jsonText);
  $("uploadEntrylist").disabled = !ready;
  if (latestState?.entrylistMeta?.loaded && latestState.raceForm?.length) {
    // allow skip if already uploaded this session
    $("uploadMeta").textContent = `Already loaded ${latestState.entrylistMeta.mergedCount} drivers — re-upload or show the table.`;
    $("uploadEntrylist").disabled = false;
  }
  $("generateModal").showModal();
};

$("closeGenerate1").onclick = () => $("generateModal").close();
$("backGenerate").onclick = () => {
  $("generateStep1").hidden = false;
  $("generateStep2").hidden = true;
};

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsText(file);
  });
}

async function maybeEnableUpload() {
  $("uploadEntrylist").disabled = !(csvText && jsonText) && !latestState?.entrylistMeta?.loaded;
}

$("csvFile").onchange = async (ev) => {
  const file = ev.target.files?.[0];
  csvText = file ? await readFileAsText(file) : "";
  maybeEnableUpload();
};
$("jsonFile").onchange = async (ev) => {
  const file = ev.target.files?.[0];
  jsonText = file ? await readFileAsText(file) : "";
  maybeEnableUpload();
};

$("uploadEntrylist").onclick = async () => {
  try {
    if (csvText && jsonText) {
      const data = await post("/api/entrylist", { csv: csvText, json: jsonText });
      latestState = { ...latestState, ...data, raceForm: data.raceForm };
      if (data.entrylistMeta) latestState.entrylistMeta = data.entrylistMeta;
    }
    const state = await fetch("/api/state").then((r) => r.json());
    render(state);
    $("generateStep1").hidden = true;
    $("generateStep2").hidden = false;
    renderRaceFormTable(state.raceForm || []);
    $("generateMeta").textContent = `${state.entrylistMeta?.mergedCount || 0} drivers loaded · ${
      state.raceForm?.length || 0
    } rows`;
  } catch (err) {
    $("uploadMeta").textContent = String(err.message || err);
    $("uploadMeta").className = "hint bad";
  }
};

$("copyTsv").onclick = async () => {
  const tsv = latestState?.raceFormTsv || "";
  await navigator.clipboard.writeText(tsv);
  $("copyState").textContent = "TSV copied — paste into a spreadsheet / form.";
  setTimeout(() => ($("copyState").textContent = ""), 2000);
};

$("resetBtn").onclick = () => $("resetModal").showModal();
$("resetModal").addEventListener("close", async () => {
  if ($("resetModal").returnValue !== "confirm") return;
  csvText = "";
  jsonText = "";
  draftPenalties = {};
  expandedKey = null;
  penaltyTargetSegmentId = null;
  const data = await post("/api/reset");
  render(data);
});

$("applyUdp").onclick = async () => {
  try {
    const data = await post("/api/udp-port", { port: Number($("udpPort").value) });
    render(data);
  } catch (err) {
    $("udpHint").textContent = String(err.message || err);
    $("udpHint").className = "hint bad";
  }
};

$("checkUdp").onclick = async () => {
  const port = Number($("udpPort").value);
  const data = await fetch(`/api/port-check?port=${port}`).then((r) => r.json());
  $("udpHint").className = `hint ${data.occupiedByOther ? "bad" : "ok"}`;
  $("udpHint").textContent = data.occupiedByOther
    ? `Port ${port} is used by ${data.otherProcess}`
    : data.occupants?.some((row) => row.ours)
      ? `Port ${port} is held by this helper — OK`
      : `Port ${port} is free`;
};

const events = new EventSource("/api/events");
events.onmessage = (ev) => render(JSON.parse(ev.data));
fetch("/api/state")
  .then((r) => r.json())
  .then(render);
