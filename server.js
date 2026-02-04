import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const VERSION = "reset-clean-availability-book-resched-break-v1";

const PORT = process.env.PORT || 10000;

// Optional: protect /vapi routes with bearer token
const BRIDGE_BEARER_TOKEN = (process.env.BRIDGE_BEARER_TOKEN || "").trim();

// Open Dental API settings (Render Environment Variables)
const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim(); // e.g. https://api.opendental.com/api/v1
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim(); // e.g. "ODFHIR <token>"

// Defaults (you can override via tool args)
const DEFAULT_PROV_NUM = Number(process.env.DEFAULT_PROV_NUM || 1);
const DEFAULT_OP_NUM = Number(process.env.DEFAULT_OP_NUM || 1);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- helpers ----------
function authMiddleware(req, res, next) {
  if (!BRIDGE_BEARER_TOKEN) return next();
  const got = (req.headers.authorization || "").trim();
  const want = `Bearer ${BRIDGE_BEARER_TOKEN}`;
  if (got !== want) {
    return res.status(401).json({ ok: false, result: "Unauthorized" });
  }
  return next();
}

// Vapi sends args in a few possible shapes. We normalize.
function extractToolArgs(body) {
  // Direct POST from your PowerShell tests
  if (body && typeof body === "object" && !body.message) return body;

  // Vapi tool-call payload shape
  const msg = body?.message;
  const toolCall =
    msg?.toolCall ||
    (Array.isArray(msg?.toolCalls) ? msg.toolCalls[0] : null) ||
    (Array.isArray(msg?.toolCallList) ? msg.toolCallList[0] : null) ||
    null;

  const args =
    toolCall?.function?.arguments ||
    toolCall?.arguments ||
    toolCall?.toolCall?.function?.arguments ||
    toolCall?.toolCall?.arguments ||
    {};

  // Sometimes arguments arrives as a JSON string
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args || {};
}

async function odFetch(path, opts = {}) {
  if (!OD_BASE_URL) {
    return {
      ok: false,
      status: 500,
      url: "",
      raw: "Missing OD_BASE_URL",
      data: null,
    };
  }
  if (!OD_AUTH_HEADER) {
    return {
      ok: false,
      status: 500,
      url: "",
      raw: "Missing OD_AUTH_HEADER",
      data: null,
    };
  }

  const url = `${OD_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = (opts.method || "GET").toUpperCase();

  const headers = {
    Authorization: OD_AUTH_HEADER,
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, url, raw: e.message, data: null };
  }

  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    ok: resp.ok,
    status: resp.status,
    url,
    raw: text,
    data,
  };
}

// ---------- health ----------
app.get("/", (req, res) => {
  res.json({ ok: true, version: VERSION });
});

app.get("/alive", (req, res) => {
  res.json({ ok: true, version: VERSION });
});

// ---------- Open Dental passthrough tester (optional) ----------
app.get("/od/try", authMiddleware, async (req, res) => {
  const path = (req.query.path || "/patients").toString();
  const out = await odFetch(path);
  res.status(out.ok ? 200 : 500).json({
    ok: out.ok,
    path,
    status: out.status,
    url: out.url,
    data: out.data,
    raw: out.ok ? undefined : out.raw,
  });
});

// ---------- Vapi tool routes ----------

// Find patient (basic by last name)
app.post("/vapi/opendental_findPatient", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);
    const lastName = (args.lastName || "").trim();
    if (!lastName) {
      return res.json({ ok: false, result: "Please provide a last name." });
    }
    const out = await odFetch(`/patients?LName=${encodeURIComponent(lastName)}`);
    if (!out.ok) {
      return res.json({
        ok: false,
        result: "I couldn’t look up the patient right now.",
        status: out.status,
        url: out.url,
        raw: out.raw,
      });
    }
    const data = Array.isArray(out.data) ? out.data : [];
    return res.json({
      ok: true,
      result: data.length ? `I found ${data.length} matching patient record(s).` : "I didn’t find any matching patient records.",
      patients: data,
      status: out.status,
      url: out.url,
    });
  } catch (e) {
    return res.json({ ok: false, result: "Something went wrong while finding the patient.", error: e.message });
  }
});

// Get available times (Slots)
app.post("/vapi/opendental_getAvailableTimes", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    const dateStart = (args.dateStart || "").trim();
    const dateEnd = (args.dateEnd || "").trim();
    const lengthMinutes = args.lengthMinutes ?? args.length ?? 40;

    const provNum = Number(args.provNum ?? args.ProvNum ?? DEFAULT_PROV_NUM ?? 1);
    const opNum = Number(args.opNum ?? args.OpNum ?? DEFAULT_OP_NUM ?? 1);

    if (!dateStart || !dateEnd) {
      return res.json({
        ok: false,
        result: "Please provide a date start and date end in YYYY-MM-DD format.",
      });
    }

    const qs = new URLSearchParams();
    qs.set("dateStart", dateStart);
    qs.set("dateEnd", dateEnd);
    qs.set("lengthMinutes", String(lengthMinutes));
    qs.set("ProvNum", String(provNum));
    qs.set("OpNum", String(opNum));

    const out = await odFetch(`/appointments/Slots?${qs.toString()}`);

    if (!out.ok) {
      return res.json({
        ok: false,
        result: "I couldn’t pull up availability right now.",
        status: out.status,
        url: out.url,
        raw: out.raw,
      });
    }

    const slots = Array.isArray(out.data) ? out.data : [];
    if (!slots.length) {
      return res.json({
        ok: true,
        result: "I don’t see any open times in that date range.",
        slots: [],
        status: out.status,
        url: out.url,
      });
    }

    slots.sort((a, b) => new Date(a.DateTimeStart) - new Date(b.DateTimeStart));
    const first = slots[0];

    const top = slots.slice(0, 3).map((s) => {
      const d = new Date(s.DateTimeStart);
      const dateStr = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${dateStr} at ${timeStr}`;
    });

    const result =
      top.length === 1
        ? `The first available time is ${top[0]}. Would you like to book it?`
        : `The first available times are ${top[0]}, ${top[1]}, or ${top[2]}. Which one would you like?`;

    return res.json({
      ok: true,
      result,
      firstSlot: first,
      slots,
      status: out.status,
      url: out.url,
    });
  } catch (e) {
    return res.json({ ok: false, result: "Something went wrong while checking availability.", error: e.message });
  }
});

// Create appointment (simple)
app.post("/vapi/opendental_createAppointment", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    const patNum = Number(args.patNum ?? args.PatNum);
    if (!patNum) {
      return res.json({ ok: false, result: "I need the patient number to book the appointment." });
    }

    const aptDateTime =
      (args.aptDateTime || args.AptDateTime || "").trim() ||
      (args.slot?.DateTimeStart || args.firstSlot?.DateTimeStart || "").trim();

    const provNum = Number(args.provNum ?? args.ProvNum ?? args.slot?.ProvNum ?? args.firstSlot?.ProvNum ?? DEFAULT_PROV_NUM ?? 1);
    const opNum = Number(args.opNum ?? args.OpNum ?? args.slot?.OpNum ?? args.firstSlot?.OpNum ?? DEFAULT_OP_NUM ?? 1);

    if (!aptDateTime) {
      return res.json({ ok: false, result: "I need a date and time to book. What day and time should I use?" });
    }

    let dt = aptDateTime;
    if (dt.includes("T")) {
      const d = new Date(dt);
      const pad = (n) => String(n).padStart(2, "0");
      dt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    }

    const pattern = args.pattern || args.Pattern || "/XXXX/";

    const body = {
      PatNum: patNum,
      AptDateTime: dt,
      Op: opNum,
      ProvNum: provNum,
      AptStatus: "Scheduled",
      Pattern: pattern,
    };

    const out = await odFetch(`/appointments`, { method: "POST", body });

    if (!out.ok) {
      return res.json({
        ok: false,
        result: "I couldn’t book that appointment time.",
        status: out.status,
        url: out.url,
        raw: out.raw,
      });
    }

    return res.json({
      ok: true,
      result: "You’re all set. I booked your appointment.",
      appointment: out.data,
      status: out.status,
      url: out.url,
    });
  } catch (e) {
    return res.json({ ok: false, result: "Something went wrong while booking the appointment.", error: e.message });
  }
});

// Stub routes (so Vapi doesn’t break if they’re called before you wire them)
app.post("/vapi/opendental_getUpcomingAppointments", authMiddleware, async (req, res) => {
  return res.json({ ok: false, result: "This tool is not wired yet." });
});
app.post("/vapi/opendental_rescheduleAppointment", authMiddleware, async (req, res) => {
  return res.json({ ok: false, result: "This tool is not wired yet." });
});
app.post("/vapi/opendental_cancelAppointment", authMiddleware, async (req, res) => {
  return res.json({ ok: false, result: "This tool is not wired yet." });
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`listening on ${PORT} (${VERSION})`);
});
