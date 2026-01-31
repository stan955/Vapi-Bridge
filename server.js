import express from "express";
import cors from "cors";

// ===============================
// Config
// ===============================

// Optional: require a Bearer token on requests to /vapi (recommended later)
const BRIDGE_BEARER_TOKEN = process.env.BRIDGE_BEARER_TOKEN || "";

// Open Dental connectivity options:
//
// Option A (recommended on Render): direct Open Dental API
//   OD_BASE_URL     e.g. https://api.opendental.com/api/v1
//   OD_AUTH_HEADER  e.g. "ODFHIR developerKey/customerKey"
//
// Option B: forward to another proxy (only if that proxy is publicly reachable from Render)
//   OD_PROXY_BASE_URL e.g. https://your-internal-proxy.com/od/proxy
//
const OD_BASE_URL = process.env.OD_BASE_URL || "";
const OD_AUTH_HEADER = process.env.OD_AUTH_HEADER || "";
const OD_PROXY_BASE_URL = process.env.OD_PROXY_BASE_URL || "";

const PORT = process.env.PORT || 3000;

// ===============================
// App
// ===============================

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/", (req, res) => {
  res.status(200).send("alive-v2");
});

// Debug: show registered routes
app.get("/routes", (req, res) => {
  const routes = [];
  app._router?.stack?.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      routes.push(`${methods.join(",")} ${layer.route.path}`);
    }
  });
  res.json({ routes });
});

// ===============================
// Helpers
// ===============================

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

function requireBearer(req, res) {
  if (!BRIDGE_BEARER_TOKEN) return true; // no token configured -> allow
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${BRIDGE_BEARER_TOKEN}`;
  if (auth !== expected) {
    unauthorized(res);
    return false;
  }
  return true;
}

// Uses global fetch (Node 18+). Render typically runs Node 18+.
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

// Build an Open Dental request either direct or via proxy
async function odGet(path) {
  // path like "/patients" or "/appointments?patNum=123"
  if (OD_PROXY_BASE_URL) {
    const url = `${OD_PROXY_BASE_URL}?path=${encodeURIComponent(path)}`;
    return httpJson(url, { method: "GET" });
  }

  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL (or set OD_PROXY_BASE_URL instead).");
  if (!OD_AUTH_HEADER) throw new Error("Missing OD_AUTH_HEADER for direct Open Dental API calls.");

  const url = `${OD_BASE_URL}${path}`;
  return httpJson(url, {
    method: "GET",
    headers: {
      Authorization: OD_AUTH_HEADER,
      "Content-Type": "application/json",
    },
  });
}

// ===============================
// Tool implementations
// ===============================

// TOOL 1 (already working): Find patient by phone or name + DOB
async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();
  const dateOfBirth = (params?.dateOfBirth || "").trim(); // YYYY-MM-DD

  const hasInput = Boolean(phone || firstName || lastName || dateOfBirth);
  if (!hasInput) {
    return { matches: [] };
  }

  const patients = await odGet("/patients");
  const list = Array.isArray(patients) ? patients : [];

  const matches = list.filter((p) => {
    const pPhones = digitsOnly(
      (p.WirelessPhone || "") + (p.HmPhone || "") + (p.WkPhone || "")
    );

    const phoneOk = phone ? pPhones.includes(phone) : true;
    const fnOk = firstName
      ? String(p.FName || "").toLowerCase().includes(firstName.toLowerCase())
      : true;
    const lnOk = lastName
      ? String(p.LName || "").toLowerCase().includes(lastName.toLowerCase())
      : true;
    const dobOk = dateOfBirth
      ? String(p.Birthdate || "").startsWith(dateOfBirth)
      : true;

    return phoneOk && fnOk && lnOk && dobOk;
  });

  // Return minimal PHI-safe payload (cap results)
  const cleaned = matches.slice(0, 10).map((p) => ({
    patNum: p.PatNum,
    firstName: p.FName || "",
    lastName: p.LName || "",
    dateOfBirth: p.Birthdate || "",
    homePhone: p.HmPhone || "",
    workPhone: p.WkPhone || "",
    mobilePhone: p.WirelessPhone || "",
    email: p.Email || "",
  }));

  return { matches: cleaned };
}

// TOOL 2 (we are implementing now): Get upcoming appointments
async function tool_getUpcomingAppointments(params) {
  const patNum = Number(params?.patNum);
  if (!patNum) throw new Error("patNum is required");

  const dateFrom = (params?.dateFrom || "").trim(); // YYYY-MM-DD (optional)
  const dateTo = (params?.dateTo || "").trim(); // YYYY-MM-DD (optional)

  // NOTE:
  // The exact Open Dental appointments query endpoint can vary by implementation.
  // Start with this common pattern. If your OD API uses different query params,
  // we will adjust ONLY this one `path` string based on the error you paste back.
  let path = `/appointments?patNum=${encodeURIComponent(String(patNum))}`;
  if (dateFrom) path += `&dateFrom=${encodeURIComponent(dateFrom)}`;
  if (dateTo) path += `&dateTo=${encodeURIComponent(dateTo)}`;

  const data = await odGet(path);
  const list = Array.isArray(data) ? data : [];

  // Normalize output shape expected by Vapi tool usage
  const appointments = list
    .map((a) => ({
      aptNum: a.AptNum ?? a.aptNum ?? null,
      startDateTime: a.AptDateTime ?? a.startDateTime ?? null,
      endDateTime: a.AptDateTimeEnd ?? a.endDateTime ?? null,
      providerId: a.ProvNum ?? a.providerId ?? null,
      locationId: a.ClinicNum ?? a.locationId ?? null,
      opNum: a.Op ?? a.opNum ?? null,
      status: a.AptStatus ?? a.status ?? null,
      appointmentType: a.ProcDescript ?? a.appointmentType ?? null,
      reasonForVisit: a.Note ?? a.reasonForVisit ?? null,
    }))
    .filter((x) => x.aptNum && x.startDateTime);

  return { appointments };
}

// TOOL 3–6: stubs (we’ll implement one-by-one later)
async function tool_getAvailability(params) {
  return {
    ok: false,
    error: "opendental_getAvailability not implemented yet",
    received: params,
  };
}

async function tool_bookAppointment(params) {
  return {
    ok: false,
    error: "opendental_bookAppointment not implemented yet",
    received: params,
  };
}

async function tool_rescheduleAppointment(params) {
  return {
    ok: false,
    error: "opendental_rescheduleAppointment not implemented yet",
    received: params,
  };
}

async function tool_breakAppointment(params) {
  return {
    ok: false,
    error: "opendental_breakAppointment not implemented yet",
    received: params,
  };
}

// Tool router
async function runTool(toolName, params) {
  switch (toolName) {
    case "opendental_findPatient":
      return await tool_findPatient(params);

    case "opendental_getUpcomingAppointments":
      return await tool_getUpcomingAppointments(params);

    case "opendental_getAvailability":
      return await tool_getAvailability(params);

    case "opendental_bookAppointment":
      return await tool_bookAppointment(params);

    case "opendental_rescheduleAppointment":
      return await tool_rescheduleAppointment(params);

    case "opendental_breakAppointment":
      return await tool_breakAppointment(params);

    default:
      return { ok: false, error: `Unknown tool: ${toolName}`, received: params };
  }
}

// ===============================
// Vapi webhook/tool handler
// ===============================
app.post("/vapi", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    const toolCallList = req.body?.toolCallList || req.body?.toolCalls || [];

    if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
      return res.status(200).json({
        results: [],
        ok: true,
        note: "No tool calls received",
        receivedBodyKeys: Object.keys(req.body || {}),
      });
    }

    const results = [];
    for (const toolCall of toolCallList) {
      const toolCallId = toolCall?.id || toolCall?.toolCallId || null;
      const name = toolCall?.name || toolCall?.toolName || "";
      const parameters = toolCall?.parameters || toolCall?.args || {};

      let output;
      try {
        output = await runTool(name, parameters);
      } catch (err) {
        output = { ok: false, error: String(err?.message || err) };
      }

      results.push({
        toolCallId,
        result: output,
      });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// Start server
// ===============================
app.listen(PORT, () => console.log("Server listening on port", PORT));
