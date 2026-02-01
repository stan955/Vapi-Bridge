import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3000;
const VERSION = "od-tool1-2-odtry";

const BRIDGE_BEARER_TOKEN = (process.env.BRIDGE_BEARER_TOKEN || "").trim();
const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim();
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim();

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
  res.json({ routes: ["GET /", "GET /health", "GET /routes", "GET /od/try?path=/...", "POST /vapi"] });
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

// 🔎 Debug endpoint: lets us probe OD endpoints without editing code
app.get("/od/try", async (req, res) => {
  // optional protection: require bearer if you set one
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
    return phoneOk && fnOk && lnOk && lnOk && dobOk;
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

      if (!apt.startDateTime) return false;
      const dt = new Date(apt.startDateTime);
      if (isNaN(dt.getTime())) return false;

      return dt.getTime() >= now.getTime();
    })
    .sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());

  return { appointments: upcoming };
}

async function runTool(name, parameters) {
  switch (name) {
    case "opendental_findPatient":
      return await tool_findPatient(parameters);
    case "opendental_getUpcomingAppointments":
      return await tool_getUpcomingAppointments(parameters);
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
