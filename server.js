import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const VERSION = "bridge-v2-clean-vapi-parser";

// Open Dental API settings (Render Environment Variables)
const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim(); // e.g. https://api.opendental.com/api/v1
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim(); // e.g. ODFHIR devKey/custKey

// Optional defaults (helps scheduling work instantly)
const DEFAULT_PROV_NUM = (process.env.DEFAULT_PROV_NUM || "").trim(); // e.g. "1"
const DEFAULT_OP_NUM = (process.env.DEFAULT_OP_NUM || "").trim(); // e.g. "1"

// Optional: protect /vapi routes with a bearer token (leave empty to disable)
const BRIDGE_BEARER_TOKEN = (process.env.BRIDGE_BEARER_TOKEN || "").trim();

function requireEnv() {
  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL env var");
  if (!OD_AUTH_HEADER) throw new Error("Missing OD_AUTH_HEADER env var");
}

function authMiddleware(req, res, next) {
  if (!BRIDGE_BEARER_TOKEN) return next();
  const got = (req.headers.authorization || "").trim();
  if (got !== `Bearer ${BRIDGE_BEARER_TOKEN}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

/**
 * Vapi sometimes POSTs a big payload like:
 * { message: { toolCallList: [ { function: { name, arguments } } ] } }
 * We want the "arguments" object.
 */
function extractToolArgs(body) {
  // If you manually POST { ...args } we accept that too.
  if (!body) return {};

  // Vapi webhooks payload shape
  const msg = body.message;
  if (msg && Array.isArray(msg.toolCallList) && msg.toolCallList[0]?.function) {
    const fn = msg.toolCallList[0].function;
    const rawArgs = fn.arguments;

    // Sometimes arguments is a JSON string, sometimes already an object
    if (typeof rawArgs === "string") {
      try {
        return JSON.parse(rawArgs);
      } catch {
        return {};
      }
    }
    if (typeof rawArgs === "object" && rawArgs !== null) return rawArgs;
  }

  // Another possible shape (toolCalls)
  if (msg && Array.isArray(msg.toolCalls) && msg.toolCalls[0]?.function) {
    const fn = msg.toolCalls[0].function;
    const rawArgs = fn.arguments;
    if (typeof rawArgs === "string") {
      try {
        return JSON.parse(rawArgs);
      } catch {
        return {};
      }
    }
    if (typeof rawArgs === "object" && rawArgs !== null) return rawArgs;
  }

  // Fallback: assume body itself is args
  return body;
}

async function odFetch(path, options = {}) {
  requireEnv();
  const url = `${OD_BASE_URL.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;

  const resp = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: OD_AUTH_HEADER,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      url,
      error: json?.Message || json?.message || "Open Dental request failed",
      raw: json,
    };
  }

  return { ok: true, status: resp.status, url, data: json };
}

// ---------- Health checks ----------
app.get("/", (req, res) => res.json({ ok: true, version: VERSION }));
app.get("/alive", (req, res) => res.json({ ok: true, version: VERSION }));

// ---------- Vapi tool routes ----------
app.post("/vapi/opendental_findPatient", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);
    const lastName = (args.lastName || "").trim();
    if (!lastName) return res.json({ ok: false, error: "lastName is required" });

    // Basic search by last name (works with your tests)
    const out = await odFetch(`/patients?LName=${encodeURIComponent(lastName)}`);
    return res.json(out);
  } catch (e) {
    return res.json({ ok: false, error: e.message || "Server error" });
  }
});

app.post("/vapi/opendental_getUpcomingAppointments", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);
    const patNum = args.patNum || args.PatNum;
    if (!patNum) return res.json({ ok: false, error: "patNum is required" });

    // Next 90 days
    const today = new Date();
    const end = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const yyyyMmDd = (d) => d.toISOString().slice(0, 10);

    const out = await odFetch(
      `/appointments?PatNum=${encodeURIComponent(patNum)}&AptStatus=Scheduled&dateStart=${yyyyMmDd(
        today
      )}&dateEnd=${yyyyMmDd(end)}`
    );

    return res.json(out);
  } catch (e) {
    return res.json({ ok: false, error: e.message || "Server error" });
  }
});

app.post("/vapi/opendental_getAvailableTimes", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    // Defaults for demo: next 14 days, 40 minute slot
    const date = (args.date || "").trim(); // yyyy-MM-dd
    const dateStart = (args.dateStart || "").trim();
    const dateEnd = (args.dateEnd || "").trim();
    const lengthMinutes = args.lengthMinutes ?? args.length ?? 40;

    const provNum = (args.provNum || args.ProvNum || DEFAULT_PROV_NUM || "").toString().trim();
    const opNum = (args.opNum || args.OpNum || DEFAULT_OP_NUM || "").toString().trim();

    // Open Dental API: /appointments/Slots parameters are optional, but ProvNum/OpNum are best.
    const qs = new URLSearchParams();

    if (date) qs.set("date", date);
    if (dateStart) qs.set("dateStart", dateStart);
    if (dateEnd) qs.set("dateEnd", dateEnd);
    if (lengthMinutes) qs.set("lengthMinutes", String(lengthMinutes));
    if (provNum) qs.set("ProvNum", provNum);
    if (opNum) qs.set("OpNum", opNum);

    const out = await odFetch(`/appointments/Slots?${qs.toString()}`);

    return res.json(out);
  } catch (e) {
    return res.json({ ok: false, error: e.message || "Server error" });
  }
});

app.post("/vapi/opendental_createAppointment", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    const patNum = args.patNum || args.PatNum;
    const aptDateTime = args.aptDateTime || args.AptDateTime; // "yyyy-MM-dd HH:mm:ss"
    const op = args.op || args.Op;
    const provNum = args.provNum || args.ProvNum || DEFAULT_PROV_NUM || undefined;

    if (!patNum) return res.json({ ok: false, error: "patNum is required" });
    if (!aptDateTime) return res.json({ ok: false, error: "aptDateTime is required" });
    if (!op) return res.json({ ok: false, error: "op is required" });

    const body = {
      PatNum: Number(patNum),
      AptDateTime: aptDateTime,
      Op: Number(op),
      AptStatus: "Scheduled",
      Pattern: args.pattern || args.Pattern || "/XXXX/", // 40 minutes default
    };

    if (provNum) body.ProvNum = Number(provNum);

    const out = await odFetch(`/appointments`, { method: "POST", body });
    return res.json(out);
  } catch (e) {
    return res.json({ ok: false, error: e.message || "Server error" });
  }
});

app.post("/vapi/opendental_rescheduleAppointment", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    const aptNum = args.aptNum || args.AptNum;
    const aptDateTime = args.aptDateTime || args.AptDateTime; // "yyyy-MM-dd HH:mm:ss"
    const op = args.op || args.Op;

    if (!aptNum) return res.json({ ok: false, error: "aptNum is required" });
    if (!aptDateTime) return res.json({ ok: false, error: "aptDateTime is required" });
    if (!op) return res.json({ ok: false, error: "op is required" });

    const body = {
      AptNum: Number(aptNum),
      AptDateTime: aptDateTime,
      Op: Number(op),
      AptStatus: "Scheduled",
    };

    const out = await odFetch(`/appointments`, { method: "PUT", body });
    return res.json(out);
  } catch (e) {
    return res.json({ ok: false, error: e.message || "Server error" });
  }
});

app.post("/vapi/opendental_cancelAppointment", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    const aptNum = args.aptNum || args.AptNum;
    if (!aptNum) return res.json({ ok: false, error: "aptNum is required" });

    // Mark as Broken (common cancellation behavior)
    const body = {
      AptNum: Number(aptNum),
      AptStatus: "Broken",
    };

    const out = await odFetch(`/appointments`, { method: "PUT", body });
    return res.json(out);
  } catch (e) {
    return res.json({ ok: false, error: e.message || "Server error" });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`listening on ${PORT} (${VERSION})`);
});
