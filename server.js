import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3000;
const VERSION = "reset-clean-availability-book-resched-break-v1";

// Optional: protect /vapi + /od/try with a bearer token
// If empty, no auth is required.
const BRIDGE_BEARER_TOKEN = (process.env.BRIDGE_BEARER_TOKEN || "").trim();

// Open Dental API settings (Render Environment Variables)
const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim(); // e.g. https://api.opendental.com/api/v1
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim(); // e.g. ODFHIR key1/key2

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => res.status(200).send(`alive-${VERSION}`));

app.get("/routes", (req, res) => {
  res.json({
    routes: ["GET /", "GET /routes", "GET /od/try?path=/...", "POST /vapi"],
    toolNamesSupported: [
      "opendental_findPatient",
      "Open_Dental_findPatient (alias)",
      "open_dental_findPatient (alias)",
      "opendental_getUpcomingAppointments",
      "opendental_getAvailability",
      "opendental_bookAppointment",
      "opendental_rescheduleAppointment",
      "opendental_breakAppointment",
    ],
  });
});

function requireBearer(req, res) {
  if (!BRIDGE_BEARER_TOKEN) return true; // no auth required
  const auth = (req.headers.authorization || "").trim();
  const expected = `Bearer ${BRIDGE_BEARER_TOKEN}`;
  if (auth !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
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

function mustHaveOdConfig() {
  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL.");
  if (!OD_AUTH_HEADER) throw new Error("Missing OD_AUTH_HEADER.");
}

async function odGet(path) {
  mustHaveOdConfig();
  const url = `${OD_BASE_URL}${path}`;
  return httpJson(url, {
    method: "GET",
    headers: { Authorization: OD_AUTH_HEADER, "Content-Type": "application/json" },
  });
}

async function odPost(path, bodyObj) {
  mustHaveOdConfig();
  const url = `${OD_BASE_URL}${path}`;
  return httpJson(url, {
    method: "POST",
    headers: { Authorization: OD_AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj || {}),
  });
}

async function odPut(path, bodyObj) {
  mustHaveOdConfig();
  const url = `${OD_BASE_URL}${path}`;
  return httpJson(url, {
    method: "PUT",
    headers: { Authorization: OD_AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj || {}),
  });
}

async function odGetMaybe(path) {
  try {
    const data = await odGet(path);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizeDateOnly(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try Date parsing (handles "June 23 1979", etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

function parseOdDateTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!str) return null;
  const isoish = str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str;
  const d = new Date(isoish);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatOdDateTime(d) {
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

function unwrapArray(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (!maybe || typeof maybe !== "object") return null;
  const keys = ["data", "items", "results", "schedules", "appointments", "slots"];
  for (const k of keys) {
    if (Array.isArray(maybe[k])) return maybe[k];
  }
  for (const v of Object.values(maybe)) {
    if (Array.isArray(v)) return v;
  }
  return null;
}

function parseScheduleDateTime(obj, timeValue, preferredDate) {
  if (!timeValue) return null;
  const raw = String(timeValue).trim();

  const dt = parseOdDateTime(raw);
  if (dt) return dt;

  const isTimeOnly = /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw);
  if (!isTimeOnly) return null;

  const dateCandidates = [
    preferredDate,
    obj.SchedDate,
    obj.schedDate,
    obj.Date,
    obj.date,
    obj.ScheduleDate,
    obj.scheduleDate,
  ].filter(Boolean);

  const dateStr = normalizeDateOnly(dateCandidates[0] || "");
  if (!dateStr) return null;

  const hhmmss = raw.length === 5 ? `${raw}:00` : raw;
  return new Date(`${dateStr}T${hhmmss}`);
}

// -------------------- DEBUG: hit any OD endpoint safely --------------------
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

// -------------------- TOOL: Find Patient --------------------
async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone || params?.mobilePhone || params?.wirelessPhone);
  const firstName = String(params?.firstName || "").trim();
  const lastName = String(params?.lastName || "").trim();
  const dob = normalizeDateOnly(params?.dateOfBirth || params?.dob || "");

  if (!phone && !firstName && !lastName && !dob) return { matches: [] };

  const patients = await odGet("/patients");
  const list = Array.isArray(patients) ? patients : [];

  const matches = list.filter((p) => {
    const pPhones = digitsOnly((p.WirelessPhone || "") + (p.HmPhone || "") + (p.WkPhone || ""));
    const phoneOk = phone ? pPhones.includes(phone) : true;
    const fnOk = firstName ? String(p.FName || "").toLowerCase().includes(firstName.toLowerCase()) : true;
    const lnOk = lastName ? String(p.LName || "").toLowerCase().includes(lastName.toLowerCase()) : true;
    const dobOk = dob ? String(p.Birthdate || "").includes(dob) : true;
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

// -------------------- TOOL: Upcoming Appointments --------------------
async function tool_getUpcomingAppointments(params) {
  const patNum = Number(params?.patNum);
  if (!patNum) throw new Error("patNum is required");

  const data = await odGet(`/appointments?patNum=${encodeURIComponent(String(patNum))}`);
  const list = Array.isArray(data) ? data : [];

  const now = new Date();

  const normalized = list.map((a) => ({
    aptNum: a.AptNum ?? null,
    startDateTime: a.AptDateTime ?? null,
    endDateTime: a.AptDateTimeEnd ?? null,
    providerId: a.ProvNum ?? null,
    locationId: a.ClinicNum ?? null,
    opNum: a.Op ?? null,
    status: a.AptStatus ?? null,
    appointmentType: a.ProcDescript ?? null,
    reasonForVisit: a.Note ?? null,
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

// -------------------- TOOL: Availability (computed) --------------------
async function tool_getAvailability(params) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const startDate = normalizeDateOnly(params?.startDate) || todayStr;
  const endDate = normalizeDateOnly(params?.endDate) || addDays(startDate, 7);

  const durationMinutes = clampInt(params?.durationMinutes, 60, 10, 240);
  const incrementMinutes = clampInt(params?.incrementMinutes, 10, 5, 30);

  const providerId =
    params?.providerId !== undefined && params?.providerId !== null && String(params.providerId).trim() !== ""
      ? Number(params.providerId)
      : null;

  const locationId =
    params?.locationId !== undefined && params?.locationId !== null && String(params.locationId).trim() !== ""
      ? Number(params.locationId)
      : 0;

  const opNum =
    params?.opNum !== undefined && params?.opNum !== null && String(params.opNum).trim() !== ""
      ? Number(params.opNum)
      : null;

  const schResp = await odGetMaybe(
    `/schedules?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}`
  );
  if (!schResp.ok) return { ok: false, error: schResp.error };

  const schedules = unwrapArray(schResp.data) || [];

  const apResp = await odGetMaybe(
    `/appointments?dateStart=${encodeURIComponent(startDate)}&dateEnd=${encodeURIComponent(endDate)}`
  );
  const appts = apResp.ok ? (unwrapArray(apResp.data) || []) : [];

  const blocks = schedules
    .map((s) => {
      const schedDate = normalizeDateOnly(
        s.SchedDate ?? s.schedDate ?? s.Date ?? s.date ?? s.ScheduleDate ?? s.scheduleDate ?? ""
      );
      const startRaw = s.StartTime ?? s.DateTimeStart ?? s.StartDateTime ?? s.startTime ?? s.dateTimeStart ?? null;
      const stopRaw = s.StopTime ?? s.DateTimeStop ?? s.EndDateTime ?? s.stopTime ?? s.dateTimeStop ?? null;

      const start = parseScheduleDateTime(s, startRaw, schedDate);
      const end = parseScheduleDateTime(s, stopRaw, schedDate);

      return {
        start,
        end,
        providerId: s.ProvNum ?? s.provNum ?? s.providerId ?? null,
        locationId: s.ClinicNum ?? s.clinicNum ?? s.locationId ?? null,
        opNum: s.Op ?? s.OpNum ?? s.opNum ?? null,
      };
    })
    .filter((b) => b.start && b.end && b.end > b.start)
    .filter((b) => {
      if (locationId !== null && b.locationId !== null && Number(b.locationId) !== Number(locationId)) return false;
      if (providerId && b.providerId && Number(b.providerId) !== Number(providerId)) return false;
      if (opNum && b.opNum && Number(b.opNum) !== Number(opNum)) return false;
      return true;
    });

  const busyAll = appts
    .map((a) => {
      const sd = parseOdDateTime(a.AptDateTime ?? null);
      if (!sd) return null;
      const ed = parseOdDateTime(a.AptDateTimeEnd ?? null) || new Date(sd.getTime() + durationMinutes * 60000);
      return {
        start: sd,
        end: ed,
        providerId: a.ProvNum ?? null,
        locationId: a.ClinicNum ?? null,
        opNum: a.Op ?? null,
        status: a.AptStatus ?? null,
      };
    })
    .filter(Boolean)
    .filter((b) => {
      const s = String(b.status || "").toLowerCase();
      if (s.includes("cancel") || s.includes("broken")) return false;
      if (locationId !== null && b.locationId !== null && Number(b.locationId) !== Number(locationId)) return false;
      if (providerId && b.providerId && Number(b.providerId) !== Number(providerId)) return false;
      if (opNum && b.opNum && Number(b.opNum) !== Number(opNum)) return false;
      return true;
    });

  function subtractIntervals(freeIntervals, busyInterval) {
    const out = [];
    for (const f of freeIntervals) {
      if (busyInterval.end <= f.start || busyInterval.start >= f.end) {
        out.push(f);
        continue;
      }
      if (busyInterval.start <= f.start && busyInterval.end >= f.end) continue;
      if (busyInterval.start > f.start)
        out.push({ start: f.start, end: new Date(Math.min(busyInterval.start.getTime(), f.end.getTime())) });
      if (busyInterval.end < f.end)
        out.push({ start: new Date(Math.max(busyInterval.end.getTime(), f.start.getTime())), end: f.end });
    }
    return out.filter((x) => x.end > x.start);
  }

  const slots = [];
  const maxSlots = 80;

  for (const block of blocks) {
    let free = [{ start: block.start, end: block.end }];

    for (const b of busyAll) {
      if (b.end <= block.start || b.start >= block.end) continue;
      free = subtractIntervals(free, b);
      if (!free.length) break;
    }

    for (const f of free) {
      let cursor = new Date(f.start.getTime());
      const m = cursor.getMinutes();
      const aligned = Math.ceil(m / incrementMinutes) * incrementMinutes;
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

  return {
    slots,
    source: "computed",
    scheduleSource: `/schedules?dateStart=${startDate}&dateEnd=${endDate}`,
    apptSource: `/appointments?dateStart=${startDate}&dateEnd=${endDate}`,
  };
}

// -------------------- TOOL: Book Appointment --------------------
// NOTE: OD API implementations can vary. We try common patterns safely.
async function tool_bookAppointment(params) {
  const patNum = Number(params?.patNum);
  const startDateTime = String(params?.startDateTime || "").trim();
  const durationMinutes = clampInt(params?.durationMinutes, 60, 10, 240);
  const providerId = Number(params?.providerId);
  const locationId = params?.locationId !== undefined ? Number(params?.locationId) : 0;
  const opNum = Number(params?.opNum);

  const appointmentType = String(params?.appointmentType || "").trim();
  const reasonForVisit = String(params?.reasonForVisit || "").trim();
  const notes = String(params?.notes || "").trim();

  if (!patNum || !startDateTime || !providerId || !opNum) {
    return { ok: false, error: "patNum, startDateTime, providerId, and opNum are required." };
  }

  const sd = parseOdDateTime(startDateTime);
  if (!sd) return { ok: false, error: "startDateTime must be parseable (prefer: YYYY-MM-DD HH:MM:SS)." };
  const ed = new Date(sd.getTime() + durationMinutes * 60000);

  // Most common OD-style fields
  const payload = {
    PatNum: patNum,
    AptDateTime: formatOdDateTime(sd),
    AptDateTimeEnd: formatOdDateTime(ed),
    ProvNum: providerId,
    ClinicNum: locationId,
    Op: opNum,
    AptStatus: "Scheduled",
    ProcDescript: appointmentType || undefined,
    Note: [reasonForVisit, notes].filter(Boolean).join(" | ") || undefined,
  };

  const candidates = ["/appointments", "/appointment"];
  let lastErr = null;

  for (const path of candidates) {
    try {
      const created = await odPost(path, payload);
      const aptNum = created?.AptNum ?? created?.aptNum ?? created?.id ?? null;
      return {
        ok: true,
        aptNum,
        confirmation: {
          patNum,
          startDateTime: payload.AptDateTime,
          endDateTime: payload.AptDateTimeEnd,
          providerId,
          locationId,
          opNum,
        },
        created,
      };
    } catch (e) {
      lastErr = String(e?.message || e);
    }
  }

  return { ok: false, error: lastErr || "Unable to create appointment." };
}

// -------------------- TOOL: Reschedule Appointment --------------------
async function tool_rescheduleAppointment(params) {
  const aptNum = Number(params?.aptNum);
  const startDateTime = String(params?.startDateTime || "").trim();
  const durationMinutes = clampInt(params?.durationMinutes, 60, 10, 240);

  if (!aptNum || !startDateTime) {
    return { ok: false, error: "aptNum and startDateTime are required." };
  }

  const sd = parseOdDateTime(startDateTime);
  if (!sd) return { ok: false, error: "startDateTime must be parseable (prefer: YYYY-MM-DD HH:MM:SS)." };
  const ed = new Date(sd.getTime() + durationMinutes * 60000);

  const patch = {
    AptNum: aptNum,
    AptDateTime: formatOdDateTime(sd),
    AptDateTimeEnd: formatOdDateTime(ed),
  };

  // Try common patterns
  const candidates = [`/appointments/${aptNum}`, `/appointment/${aptNum}`, `/appointments`];
  let lastErr = null;

  for (const path of candidates) {
    try {
      const resp =
        path === "/appointments"
          ? await odPut(path, patch) // some APIs update by AptNum in body
          : await odPut(path, patch);

      return { ok: true, aptNum, updated: resp, confirmation: patch };
    } catch (e) {
      lastErr = String(e?.message || e);
    }
  }

  return { ok: false, error: lastErr || "Unable to reschedule appointment." };
}

// -------------------- TOOL: Break (Cancel) Appointment --------------------
async function tool_breakAppointment(params) {
  const aptNum = Number(params?.aptNum);
  const reason = String(params?.reason || params?.note || "").trim();

  if (!aptNum) return { ok: false, error: "aptNum is required." };

  const patch = {
    AptNum: aptNum,
    AptStatus: "Broken", // common OD status label
    Note: reason || undefined,
  };

  const candidates = [`/appointments/${aptNum}`, `/appointment/${aptNum}`, `/appointments`];
  let lastErr = null;

  for (const path of candidates) {
    try {
      const resp = await odPut(path, patch);
      return { ok: true, aptNum, updated: resp, confirmation: patch };
    } catch (e) {
      lastErr = String(e?.message || e);
    }
  }

  return { ok: false, error: lastErr || "Unable to break/cancel appointment." };
}

// -------------------- Tool Router --------------------
async function runTool(name, parameters) {
  switch (name) {
    // patient lookup (support a couple alias names so you don't get burned)
    case "opendental_findPatient":
    case "Open_Dental_findPatient":
    case "open_dental_findPatient":
      return await tool_findPatient(parameters);

    case "opendental_getUpcomingAppointments":
      return await tool_getUpcomingAppointments(parameters);

    case "opendental_getAvailability":
      return await tool_getAvailability(parameters);

    case "opendental_bookAppointment":
      return await tool_bookAppointment(parameters);

    case "opendental_rescheduleAppointment":
      return await tool_rescheduleAppointment(parameters);

    case "opendental_breakAppointment":
      return await tool_breakAppointment(parameters);

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

// -------------------- Vapi endpoint --------------------
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
