import express from "express";
import cors from "cors";

// ===============================
// Config
// ===============================

// Optional: require a Bearer token on requests to /vapi (recommended)
const BRIDGE_BEARER_TOKEN = process.env.BRIDGE_BEARER_TOKEN || "";

// How this bridge talks to Open Dental:
// Option A) Direct to Open Dental API: set OD_BASE_URL + OD_AUTH_HEADER
// Option B) Forward to an internal proxy: set OD_PROXY_BASE_URL (e.g., http://127.0.0.1:5050/od/proxy)
//
// If OD_PROXY_BASE_URL is set, this server will call:
//   `${OD_PROXY_BASE_URL}?path=${encodeURIComponent("/patients")}`
// Otherwise it will call:
//   `${OD_BASE_URL}/patients` with Authorization header OD_AUTH_HEADER
//
const OD_BASE_URL = process.env.OD_BASE_URL || ""; // e.g. https://api.opendental.com/api/v1
const OD_AUTH_HEADER = process.env.OD_AUTH_HEADER || ""; // e.g. "ODFHIR devKey/customerKey"
const OD_PROXY_BASE_URL = process.env.OD_PROXY_BASE_URL || ""; // e.g. http://127.0.0.1:5050/od/proxy

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

// Use global fetch if available (Node 18+). If not, this will throw with a clear message.
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
    const msg =
      typeof data === "string"
        ? data
        : JSON.stringify(data || {}, null, 2);
    throw new Error(`HTTP ${resp.status} ${resp.statusText} from ${url}: ${msg}`);
  }
  return data;
}

// Build an Open Dental request either direct or via proxy
async function odGet(path) {
  // path like "/patients" or "/appointments?PatNum=123"
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

// Normalize phone digits
function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

// ===============================
// Tool implementations
// ===============================

async function tool_findPatient(params) {
  // Accepts: phone OR firstName/lastName/dateOfBirth
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();
  const dateOfBirth = (params?.dateOfBirth || "").trim(); // YYYY-MM-DD recommended

  // Strategy:
  // - Pull patient list from OD and filter locally (works with your current /patients list setup).
  // - Later you can optimize by using OD search endpoints/params if desired.
  const patients = await odGet("/patients");

  // Defensive: ensure array
  const list = Array.isArray(patients) ? patients : [];

  const matches = list.filter((p) => {
    const pPhone = digitsOnly(p.WirelessPhone || p.HmPhone || p.WkPhone || "");
    const phoneOk = phone ? pPhone.includes(phone) : true;

    const fnOk = firstName ? String(p.FName || "").toLowerCase().includes(firstName.toLowerCase()) : true;
    const lnOk = lastName ? String(p.LName || "").toLowerCase().includes(lastName.toLowerCase()) : true;

    // Your OD sample returns Birthdate like "1980-06-05" already
    const dobOk = dateOfBirth ? String(p.Birthdate || "").startsWith(dateOfBirth) : true;

    // Require at least one meaningful input
    const hasInput = Boolean(phone || firstName || lastName || dateOfBirth);
    if (!hasInput) return false;

    return phoneOk && fnOk && lnOk && dobOk;
  });

  // Return minimal PHI-safe payload
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

async function tool_getUpcomingAppointments(params) {
  // TODO: implement with your Open Dental appointments endpoint
  // inputs: patNum, dateFrom, dateTo
  return {
    ok: false,
    error: "opendental_getUpcomingAppointments not implemented yet",
    received: params,
  };
}

async function tool_getAvailability(params) {
  // TODO: implement availability logic (schedule + operatories + appointment type)
  return {
    ok: false,
    error: "opendental_getAvailability not implemented yet",
    received: params,
  };
}

async function tool_bookAppointment(params) {
  // TODO: implement booking via Open Dental appointments create/schedule endpoint
  return {
    ok: false,
    error: "opendental_bookAppointment not implemented yet",
    received: params,
  };
}

async function tool_rescheduleAppointment(params) {
  // TODO: implement reschedule via Open Dental appointments update endpoint
  return {
    ok: false,
    error: "opendental_rescheduleAppointment not implemented yet",
    received: params,
  };
}

async function tool_breakAppointment(params) {
  // TODO: implement break/cancel via Open Dental appointments break endpoint
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
//
// Vapi will POST a payload that includes tool calls.
// Your existing code was mapping toolCallList -> results.
// We'll support both shapes:
// - req.body.toolCallList
// - req.body.toolCalls
//
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
