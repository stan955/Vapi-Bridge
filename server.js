import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3000;
const VERSION = "od-tool1-2-3";

// Optional: require Bearer token if set
const BRIDGE_BEARER_TOKEN = (process.env.BRIDGE_BEARER_TOKEN || "").trim();

// Open Dental API config
const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim(); // https://api.opendental.com/api/v1
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim(); // ODFHIR key1/key2

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => res.status(200).send(`alive-${VERSION}`));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    node: process.version,
    hasBearer: Boolean(BRIDGE_BEARER_TOKEN),
    hasOdBaseUrl: Boolean(OD_BASE_URL),
    hasOdAuthHeader: Boolean(OD_AUTH_HEADER),
  });
});

app.get("/routes", (req, res) => {
  res.json({
    routes: [
      "GET /",
      "GET /health",
      "GET /routes",
      "GET /od/try?path=/...",
      "POST /vapi",
    ],
  });
});

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

function requireBearer(req, res) {
  if (!BRIDGE_BEARER_TOKEN) return true;
  const auth = (req.headers.authorization || "").trim();
  const expected = `Bearer ${BRIDGE_BEARER_TOKEN}`;
  if (auth !== expected) {
    unauthorized(res);
    return false;
  }
  return true;
}

async function httpJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!resp.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data || {}, null, 2);
    throw new Error(`HTTP ${resp.status} ${resp.statusText} from ${url}: ${msg}`);
  }
  return data;
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

// Accepts "YYYY-MM-DD", "MM/DD/YYYY", "June 23 1979"
function normalizeDob(input) {
  const s0 = String(input || "").trim();
  if (!s0) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) return s0;

  const m1 = s0.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const mm = String(m1[1]).padStart(2, "0");
    const dd = String(m1[2]).padStart(2, "0");
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const monthMap = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", sept: "09", september: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12",
  };

  const cleaned = s0.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(" ");
  if (parts.length >= 3) {
    const month = monthMap[parts[0]];
    const day = parts[1]?.replace(/\D/g, "");
    const year = parts[2]?.replace(/\D/g, "");
    if (month && day && year && year.length === 4) {
      return `${year}-${month}-${String(day).padStart(2, "0")}`;
    }
  }

  const d = new Date(s0);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function normalizeDateOnly(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const mm = String(m1[1]).padStart(2, "0");
    const dd = String(m1[2]).padStart(2, "0");
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

// Parse "YYYY-MM-DD HH:MM:SS" or ISO-ish; treat as local time
function parseOdDateTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;

  // Convert "2026-02-09 10:00:00" -> "2026-02-09T10:00:00"
  const isoish = str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str;
  const d = new Date(isoish);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatOdDateTime(d) {
  // Return "YYYY-MM-DD HH:MM:SS"
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  const SS = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clampInt(n, def, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

async function odGet(path) {
  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL.");
  if (!OD_AUTH_HEADER) throw new Error("Missing OD_AUTH_HEADER.");
  const url = `${OD_BASE_URL}${path}`;
  return httpJson(url, {
    method: "GET",
    headers: {
      Authorization: OD_AUTH_HEADER,
      "Content-Type": "application/json",
    },
  });
}

async function odGetMaybe(path) {
  try {
    return await odGet(path);
  } catch {
    return null;
  }
}

// Debug helper: probe OD endpoints without editing code
app.get("/od/try", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    const path = String(req.query.path || "").trim();
    if (!path || !path.startsWith("/")) {
      return res.status(400).json({ ok: false, error: "Provide ?path=/something" });
    }
    const data = await odGet(path);
    res.json({ ok: true, path, data });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
});

// -------------------- TOOLS --------------------

async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();
  const dobIso = normalizeDob((params?.dateOfBirth || "").trim());

  if (!phone && !firstName && !lastName && !dobIso) return { matches: [] };

  const patients = await odGet("/patients");
  const list = Array.isArray(patients) ? patients : [];

  const matches = list.filter((p) => {
    const pPhones = digitsOnly((p.WirelessPhone || "") + (p.HmPhone || "") + (p.WkPhone || ""));
    const phoneOk = phone ? pPhones.includes(phone) : true;
    const fnOk = firstName ? String(p.FName || "").toLowerCase().includes(firstName.toLowerCase()) : true;
    const lnOk = lastName ? String(p.LName || "").toLowerCase().includes(lastName.toLowerCase()) : true;
    const dobOk = dobIso ? String(p.Birthdate || "").startsWith(dobIso) : true;
    return phoneOk && fnOk && lnOk && dobOk;
  });

  return {
    matches: matches.slice(0, 10).map((p) => ({
      patNum: p.PatNum,
      firstName: p.FName || "",
      lastName: p.LName || "",
      dateOfBirth: p.Birthdate || "",
      homePhone: p.HmPhone || "",
      workPhone: p.WkPhone || "",
      mobilePhone: p.WirelessPhone || "",
      email: p.Email || "",
    })),
  };
}

async function tool_getUpcomingAppointments(params) {
  const patNum = Number(params?.patNum);
  if (!patNum) throw new Error("patNum is required");

  const data = await odGet(`/appointments?patNum=${encodeURIComponent(String(patNum))}`);
  const list = Array.isArray(data) ? data : [];

  const now = new Date();

  const normalized = list.map((a) => ({
    aptNum: a.AptNum ?? a.aptNum ?? null,
    startDateTime: a.AptDateTime ?? a.startDateTime ?? null,
    endDateTime: a.AptDateTimeEnd ?? a.endDateTime ?? null,
    providerId: a.ProvNum ?? a.providerId ?? null,
    locationId: a.ClinicNum ?? a.locationId ?? null,
    opNum: a.Op ?? a.opNum ?? null,
    status: a.AptStatus ?? a.status ?? null,
    appointmentType: a.ProcDescript ?? a.appointmentType ?? null,
    reasonForVisit: a.Note ?? a.reasonForVisit ?? null,
  }));

  const upcoming = normalized
    .filter((apt) => {
      const statusOk = apt.status === "Scheduled" || apt.status === "Planned";
      if (!statusOk) return false;

      const dt = parseOdDateTime(apt.startDateTime);
      if (!dt) return false;

      return dt.getTime() >= now.getTime();
    })
    .sort((a, b) => parseOdDateTime(a.startDateTime).getTime() - parseOdDateTime(b.startDateTime).getTime());

  return { appointments: upcoming };
}

/**
 * Tool 3: Find available appointment slots
 * Inputs:
 *  - startDate: "YYYY-MM-DD" (defaults to today)
 *  - endDate: "YYYY-MM-DD" (defaults to startDate + 7)
 *  - durationMinutes: number (defaults 60)
 *  - providerId: optional
 *  - locationId: optional (defaults 0)
 *  - opNum: optional
 *  - incrementMinutes: optional (defaults 10)
 * Output:
 *  - slots: [{ startDateTime, endDateTime, providerId, locationId, opNum }]
 */
async function tool_getAvailableSlots(params) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const startDate = normalizeDateOnly(params?.startDate) || todayStr;
  const endDate = normalizeDateOnly(params?.endDate) || addDays(startDate, 7);

  const durationMinutes = clampInt(params?.durationMinutes, 60, 10, 240);
  const incrementMinutes = clampInt(params?.incrementMinutes, 10, 5, 30);

  const providerId = params?.providerId !== undefined && params?.providerId !== null && String(params.providerId).trim() !== ""
    ? Number(params.providerId)
    : null;

  const locationId = params?.locationId !== undefined && params?.locationId !== null && String(params.locationId).trim() !== ""
    ? Number(params.locationId)
    : 0;

  const opNum = params?.opNum !== undefined && params?.opNum !== null && String(params.opNum).trim() !== ""
    ? Number(params.opNum)
    : null;

  // 1) Try a "native availability" endpoint first (if your OD API supports it)
  const nativeCandidates = [
    `/appointments/available?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}&minutes=${durationMinutes}` +
      (providerId ? `&provNum=${providerId}` : "") +
      (locationId !== null ? `&clinicNum=${locationId}` : "") +
      (opNum ? `&opNum=${opNum}` : ""),
    `/availableappointments?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}&minutes=${durationMinutes}` +
      (providerId ? `&provNum=${providerId}` : "") +
      (locationId !== null ? `&clinicNum=${locationId}` : "") +
      (opNum ? `&opNum=${opNum}` : ""),
    `/slots?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}&minutes=${durationMinutes}` +
      (providerId ? `&provNum=${providerId}` : "") +
      (locationId !== null ? `&clinicNum=${locationId}` : "") +
      (opNum ? `&opNum=${opNum}` : "")
  ];

  for (const p of nativeCandidates) {
    const native = await odGetMaybe(p);
    if (native && Array.isArray(native)) {
      const slots = native.slice(0, 60).map((s) => {
        const start = s.StartDateTime ?? s.startDateTime ?? s.AptDateTime ?? s.start ?? null;
        const end = s.EndDateTime ?? s.endDateTime ?? s.end ?? null;

        const sd = parseOdDateTime(start);
        const ed = end ? parseOdDateTime(end) : (sd ? new Date(sd.getTime() + durationMinutes * 60000) : null);

        return {
          startDateTime: start || (sd ? formatOdDateTime(sd) : null),
          endDateTime: end || (ed ? formatOdDateTime(ed) : null),
          providerId: s.ProvNum ?? s.providerId ?? providerId ?? null,
          locationId: s.ClinicNum ?? s.locationId ?? locationId ?? 0,
          opNum: s.Op ?? s.opNum ?? opNum ?? null,
        };
      }).filter(x => x.startDateTime && x.endDateTime);

      return { slots, source: "native" };
    }
  }

  // 2) Fallback: compute slots using schedules + appointments
  // Try common schedule endpoints
  const scheduleCandidates = [
    `/schedules?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}`,
    `/schedule?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}`,
    `/schedules`,
  ];

  let schedules = null;
  for (const p of scheduleCandidates) {
    const s = await odGetMaybe(p);
    if (s && Array.isArray(s)) { schedules = s; break; }
  }
  if (!schedules) {
    return {
      ok: false,
      error:
        "Could not fetch schedules from Open Dental. Your OD API may use a different schedules endpoint. Use /od/try to inspect schedules endpoints.",
    };
  }

  // Try common appointment range endpoints (fallback to /appointments and filter if needed)
  const apptCandidates = [
    `/appointments?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}`,
    `/appointments`,
  ];

  let appts = null;
  for (const p of apptCandidates) {
    const a = await odGetMaybe(p);
    if (a && Array.isArray(a)) { appts = a; break; }
  }
  appts = Array.isArray(appts) ? appts : [];

  // Normalize schedules
  const schedBlocks = schedules.map((s) => {
    const start = s.StartTime ?? s.startTime ?? s.DateTimeStart ?? s.dateTimeStart ?? s.StartDateTime ?? null;
    const stop = s.StopTime ?? s.stopTime ?? s.DateTimeStop ?? s.dateTimeStop ?? s.EndDateTime ?? null;

    return {
      start: parseOdDateTime(start),
      end: parseOdDateTime(stop),
      providerId: s.ProvNum ?? s.provNum ?? s.providerId ?? null,
      locationId: s.ClinicNum ?? s.clinicNum ?? s.locationId ?? null,
      opNum: s.Op ?? s.opNum ?? null,
      schedType: s.SchedType ?? s.schedType ?? null,
    };
  }).filter(b => b.start && b.end);

  // Filter schedule blocks by clinic/provider/op if supplied
  const filteredBlocks = schedBlocks.filter((b) => {
    if (locationId !== null && b.locationId !== null && Number(b.locationId) !== Number(locationId)) return false;
    if (providerId && b.providerId && Number(b.providerId) !== Number(providerId)) return false;
    if (opNum && b.opNum && Number(b.opNum) !== Number(opNum)) return false;
    return true;
  });

  // Normalize appointments (used as "busy" blocks)
  const busy = appts.map((a) => {
    const start = a.AptDateTime ?? a.startDateTime ?? null;
    const end = a.AptDateTimeEnd ?? a.endDateTime ?? null;
    const status = a.AptStatus ?? a.status ?? null;

    return {
      start: parseOdDateTime(start),
      end: parseOdDateTime(end) || (parseOdDateTime(start) ? new Date(parseOdDateTime(start).getTime() + 60 * 60000) : null),
      providerId: a.ProvNum ?? a.providerId ?? null,
      locationId: a.ClinicNum ?? a.locationId ?? null,
      opNum: a.Op ?? a.opNum ?? null,
      status
    };
  }).filter(x => x.start && x.end);

  // Consider these statuses as blocking time (conservative)
  const isBlockingStatus = (st) => {
    const s = String(st || "").toLowerCase();
    if (!s) return true;
    if (s.includes("cancel")) return false;
    if (s.includes("broken")) return false;
    return true;
  };

  const busyFiltered = busy.filter((b) => {
    if (!isBlockingStatus(b.status)) return false;
    if (locationId !== null && b.locationId !== null && Number(b.locationId) !== Number(locationId)) return false;
    if (providerId && b.providerId && Number(b.providerId) !== Number(providerId)) return false;
    if (opNum && b.opNum && Number(b.opNum) !== Number(opNum)) return false;
    return true;
  });

  // Subtract busy blocks from schedule blocks to produce free intervals
  function subtractIntervals(freeIntervals, busyInterval) {
    const out = [];
    for (const f of freeIntervals) {
      // no overlap
      if (busyInterval.end <= f.start || busyInterval.start >= f.end) {
        out.push(f);
        continue;
      }
      // overlap cases
      if (busyInterval.start <= f.start && busyInterval.end >= f.end) {
        continue; // fully covers
      }
      if (busyInterval.start > f.start) {
        out.push({ start: f.start, end: new Date(Math.min(busyInterval.start.getTime(), f.end.getTime())) });
      }
      if (busyInterval.end < f.end) {
        out.push({ start: new Date(Math.max(busyInterval.end.getTime(), f.start.getTime())), end: f.end });
      }
    }
    return out.filter(x => x.end > x.start);
  }

  const slots = [];
  const maxSlots = 60;

  for (const block of filteredBlocks) {
    let free = [{ start: block.start, end: block.end }];

    // subtract all busy intervals that overlap this block window
    for (const b of busyFiltered) {
      // quick prune
      if (b.end <= block.start || b.start >= block.end) continue;
      free = subtractIntervals(free, b);
      if (free.length === 0) break;
    }

    // generate slot start times within free intervals
    for (const f of free) {
      let cursor = new Date(f.start.getTime());

      // Align cursor to incrementMinutes
      const mins = cursor.getMinutes();
      const aligned = Math.ceil(mins / incrementMinutes) * incrementMinutes;
      cursor.setMinutes(aligned, 0, 0);

      while (cursor.getTime() + durationMinutes * 60000 <= f.end.getTime()) {
        const end = new Date(cursor.getTime() + durationMinutes * 60000);
        slots.push({
          startDateTime: formatOdDateTime(cursor),
          endDateTime: formatOdDateTime(end),
          providerId: providerId ?? block.providerId ?? null,
          locationId: locationId ?? block.locationId ?? 0,
          opNum: opNum ?? block.opNum ?? null,
        });

        if (slots.length >= maxSlots) break;
        cursor = new Date(cursor.getTime() + incrementMinutes * 60000);
      }
      if (slots.length >= maxSlots) break;
    }
    if (slots.length >= maxSlots) break;
  }

  return { slots, source: "computed" };
}

async function runTool(name, parameters) {
  switch (name) {
    case "opendental_findPatient":
      return await tool_findPatient(parameters);

    case "opendental_getUpcomingAppointments":
      return await tool_getUpcomingAppointments(parameters);

    case "opendental_getAvailableSlots":
      return await tool_getAvailableSlots(parameters);

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

app.post("/vapi", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    const toolCallList = req.body?.toolCallList || req.body?.toolCalls || [];
    const list = Array.isArray(toolCallList) ? toolCallList : [];

    const results = [];
    for (const t of list) {
      const toolCallId = t?.id || t?.toolCallId || null;
      const name = t?.name || t?.toolName || "";
      const parameters = t?.parameters || t?.args || {};

      let output;
      try {
        output = await runTool(name, parameters);
      } catch (err) {
        output = { ok: false, error: String(err?.message || err) };
      }

      results.push({ toolCallId, result: output });
    }

    res.json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(PORT, () => console.log(`listening on ${PORT} (${VERSION})`));
