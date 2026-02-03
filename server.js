import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  console.log("REQ", req.method, req.path);
  next();
});

const PORT = process.env.PORT || 10000;

const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim();
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim();

app.get("/alive", (req, res) => {
  res.status(200).send("alive");
});

function getToolArgs(reqBody) {
  try {
    if (!reqBody) return {};
    const msg = reqBody.message || reqBody;

    if (msg.toolCallList && msg.toolCallList.length) {
      const tc = msg.toolCallList[0];
      if (tc && typeof tc.toolInput === "object" && tc.toolInput) return tc.toolInput;
    }

    if (msg.toolCalls && msg.toolCalls.length) {
      const tc = msg.toolCalls[0];
      const args = tc?.function?.arguments;
      if (typeof args === "string" && args.trim()) return JSON.parse(args);
      if (typeof args === "object" && args) return args;
    }

    return reqBody;
  } catch {
    return {};
  }
}

async function odFetch(path, options = {}) {
  if (!OD_BASE_URL) throw new Error("OD_BASE_URL missing");
  if (!OD_AUTH_HEADER) throw new Error("OD_AUTH_HEADER missing");

  const controller = new AbortController();
  const timeoutMs = 9000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const method = (options.method || "GET").toUpperCase();
  console.log("OD OUT ->", method, path);

  try {
    const r = await fetch(`${OD_BASE_URL}${path}`, {
      ...options,
      method,
      headers: {
        Authorization: OD_AUTH_HEADER,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const text = await r.text();
    console.log("OD IN <-", method, path, "status", r.status, "bodyPreview", String(text).slice(0, 180));

    return { status: r.status, text };
  } catch (e) {
    console.log("OD FAIL !!", method, path, String(e?.message || e));
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toIsoDateOnly(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nextBusinessDaysStart(countDays) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const dates = [];
  let d = new Date(start);

  while (dates.length < countDays) {
    const day = d.getDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend) dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function buildCandidateSlots(days, startHour, endHour, slotMinutes) {
  const slots = [];
  for (const day of days) {
    const dayStart = new Date(day);
    dayStart.setHours(startHour, 0, 0, 0);

    const dayEnd = new Date(day);
    dayEnd.setHours(endHour, 0, 0, 0);

    let cursor = new Date(dayStart);
    while (cursor.getTime() + slotMinutes * 60000 <= dayEnd.getTime()) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + slotMinutes * 60000);
      slots.push({ start: slotStart, end: slotEnd });
      cursor = new Date(cursor.getTime() + slotMinutes * 60000);
    }
  }
  return slots;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function normalizePhoneDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function isTitleWord(w) {
  const t = String(w || "").toLowerCase().replace(/\./g, "");
  return t === "mr" || t === "mrs" || t === "ms" || t === "dr";
}

function extractLastNameFromAnyName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const filtered = parts.filter((p) => !isTitleWord(p));
  if (!filtered.length) return "";
  return filtered[filtered.length - 1];
}

/* Optional browser testing */
app.get("/od/try", async (req, res) => {
  try {
    const path = req.query.path;
    if (!path) return res.status(400).json({ ok: false, error: "missing path" });

    const r = await odFetch(String(path));
    return res.status(200).json({
      ok: true,
      path,
      status: r.status,
      data: safeJsonParse(r.text)
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   TOOL: opendental_findPatient
========================= */

app.post("/vapi/opendental_findPatient", async (req, res) => {
  try {
    const args = getToolArgs(req.body);

    let lastName = (args.lastName || "").trim();
    if (!lastName && args.name) lastName = extractLastNameFromAnyName(args.name);

    if (!lastName) {
      return res.status(200).json({ ok: false, error: "lastName required" });
    }

    const r = await odFetch(`/patients?LName=${encodeURIComponent(lastName)}`);
    const data = safeJsonParse(r.text);

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error("findPatient error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   TOOL: opendental_getUpcomingAppointments
   Inputs expected: patNum (number) optional
========================= */

app.post("/vapi/opendental_getUpcomingAppointments", async (req, res) => {
  try {
    const args = getToolArgs(req.body);
    const patNum = args.patNum ?? args.PatNum ?? null;

    const r = await odFetch(`/appointments`);
    const appts = safeJsonParse(r.text);

    if (!Array.isArray(appts)) {
      return res.status(200).json({
        ok: false,
        error: "Unexpected appointments response",
        raw: appts
      });
    }

    const now = Date.now();
    const filtered = appts
      .filter((a) => {
        if (patNum == null) return true;
        return String(a.PatNum) === String(patNum);
      })
      .filter((a) => {
        const dt = new Date(a.AptDateTime || a.AptDate || a.DateTime || a.DateT || a.DateTimeStart || 0).getTime();
        return Number.isFinite(dt) && dt >= now;
      })
      .slice(0, 20);

    return res.status(200).json({ ok: true, appointments: filtered });
  } catch (e) {
    console.error("getUpcomingAppointments error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   TOOL: opendental_getAvailableTimes
   This ACTUALLY calls Open Dental to pull existing appointments,
   then computes open slots.
   Inputs you can pass from Vapi prompt/tool:
     slotMinutes (default 60)
     daysAhead (default 7)
========================= */

app.post("/vapi/opendental_getAvailableTimes", async (req, res) => {
  try {
    const args = getToolArgs(req.body);
    console.log("Availability tool args:", args);

    const slotMinutes = Number(args.slotMinutes || 60);
    const daysAhead = Number(args.daysAhead || 7);

    const workStartHour = 9;
    const workEndHour = 17;

    const days = nextBusinessDaysStart(daysAhead);
    const candidates = buildCandidateSlots(days, workStartHour, workEndHour, slotMinutes);

    const r = await odFetch(`/appointments`);
    const appts = safeJsonParse(r.text);

    if (!Array.isArray(appts)) {
      return res.status(200).json({
        ok: false,
        error: "Unexpected appointments response from Open Dental",
        raw: appts
      });
    }

    const busy = appts
      .map((a) => {
        const start = new Date(a.AptDateTime || a.DateTimeStart || a.AptDate || a.DateTime || 0);
        let minutes = Number(a.Length || a.Minutes || a.Duration || 60);
        if (!Number.isFinite(minutes) || minutes <= 0) minutes = 60;
        const end = new Date(start.getTime() + minutes * 60000);
        return { start, end };
      })
      .filter((b) => Number.isFinite(b.start.getTime()));

    const openSlots = [];
    for (const c of candidates) {
      const blocked = busy.some((b) => overlaps(c.start, c.end, b.start, b.end));
      if (!blocked) {
        openSlots.push({
          startISO: c.start.toISOString(),
          endISO: c.end.toISOString(),
          date: toIsoDateOnly(c.start),
          display: c.start.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
        });
      }
      if (openSlots.length >= 6) break;
    }

    return res.status(200).json({
      ok: true,
      openSlots,
      note: openSlots.length ? "computed from existing Open Dental appointments" : "no open slots found in computed window"
    });
  } catch (e) {
    console.error("getAvailableTimes error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   TOOL: opendental_createAppointment
   This attempts a REAL create via Open Dental POST /appointments
   You must provide the fields Open Dental requires.
   We do not guess required fields.
   Whatever Open Dental returns will be surfaced.
========================= */

app.post("/vapi/opendental_createAppointment", async (req, res) => {
  try {
    const args = getToolArgs(req.body);
    console.log("CreateAppointment tool args:", args);

    const body = args;

    const r = await odFetch(`/appointments`, {
      method: "POST",
      body: JSON.stringify(body)
    });

    const data = safeJsonParse(r.text);

    return res.status(200).json({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      data
    });
  } catch (e) {
    console.error("createAppointment error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   TOOL: opendental_rescheduleAppointment
   Attempts PUT /appointments (surface OD response)
========================= */

app.post("/vapi/opendental_rescheduleAppointment", async (req, res) => {
  try {
    const args = getToolArgs(req.body);
    console.log("Reschedule tool args:", args);

    const r = await odFetch(`/appointments`, {
      method: "PUT",
      body: JSON.stringify(args)
    });

    return res.status(200).json({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      data: safeJsonParse(r.text)
    });
  } catch (e) {
    console.error("rescheduleAppointment error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

/* =========================
   TOOL: opendental_cancelAppointment
   Attempts DELETE /appointments (surface OD response)
========================= */

app.post("/vapi/opendental_cancelAppointment", async (req, res) => {
  try {
    const args = getToolArgs(req.body);
    console.log("Cancel tool args:", args);

    const r = await odFetch(`/appointments`, {
      method: "DELETE",
      body: JSON.stringify(args)
    });

    return res.status(200).json({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      data: safeJsonParse(r.text)
    });
  } catch (e) {
    console.error("cancelAppointment error:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
