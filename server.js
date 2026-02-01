import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3000;
const VERSION = "reset-clean-1";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => res.status(200).send(`alive-${VERSION}`));

app.get("/health", (req, res) => {
  res.json({ ok: true, version: VERSION, node: process.version });
});

app.get("/routes", (req, res) => {
  res.json({ routes: ["GET /", "GET /health", "GET /routes", "POST /vapi"] });
});

app.post("/vapi", (req, res) => {
  const toolCallList = req.body?.toolCallList || req.body?.toolCalls || [];
  const list = Array.isArray(toolCallList) ? toolCallList : [];

  const results = list.map((t) => ({
    toolCallId: t?.id || t?.toolCallId || null,
    result: {
      ok: true,
      echoToolName: t?.name || t?.toolName || "",
      echoParameters: t?.parameters || t?.args || {}
    }
  }));

  res.json({ results });
});

app.listen(PORT, () => console.log(`listening on ${PORT} (${VERSION})`));
  const toolCallList = req.body?.toolCallList || req.body?.toolCalls || [];
  const list = Array.isArray(toolCallList) ? toolCallList : [];

  const results = list.map((t) => ({
    toolCallId: t?.id || t?.toolCallId || null,
    result: {
      ok: true,
      echoToolName: t?.name || t?.toolName || "",
      echoParameters: t?.parameters || t?.args || {}
    }
  }));

  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`vapi-bridge listening on ${PORT} (${VERSION})`);
});
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
  if (OD_PROXY_BASE_URL) {
    const url = `${OD_PROXY_BASE_URL}?path=${encodeURIComponent(path)}`;
    return httpJson(url, { method: "GET" });
  }

  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL (or set OD_PROXY_BASE_URL instead).");
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

async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();
  const dobIso = normalizeDob((params?.dateOfBirth || "").trim());

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

  return {
    appointments: list.map((a) => ({
      aptNum: a.AptNum ?? a.aptNum ?? null,
      startDateTime: a.AptDateTime ?? a.startDateTime ?? null,
      endDateTime: a.AptDateTimeEnd ?? a.endDateTime ?? null,
      providerId: a.ProvNum ?? a.providerId ?? null,
      locationId: a.ClinicNum ?? a.locationId ?? null,
      opNum: a.Op ?? a.opNum ?? null,
      status: a.AptStatus ?? a.status ?? null,
      appointmentType: a.ProcDescript ?? a.appointmentType ?? null,
      reasonForVisit: a.Note ?? a.reasonForVisit ?? null,
    })),
  };
}

async function runTool(toolName, params) {
  switch (toolName) {
    case "opendental_findPatient":
      return await tool_findPatient(params);
    case "opendental_getUpcomingAppointments":
      return await tool_getUpcomingAppointments(params);
    default:
      return { ok: false, error: `Unknown tool: ${toolName}`, received: params };
  }
}

app.post("/vapi", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    const toolCallList = req.body?.toolCallList || req.body?.toolCalls || [];
    if (!Array.isArray(toolCallList) || toolCallList.length === 0) {
      return res.status(200).json({ results: [] });
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

      results.push({ toolCallId, result: output });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log("Server listening on port", PORT));
});

// ===============================
// Helpers
// ===============================

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

function requireBearer(req, res) {
  // If no bearer token is configured, allow requests
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

// Converts "June 23 1979", "06/23/1979", "6-23-1979" -> "1979-06-23"
function normalizeDob(input) {
  const s0 = String(input || "").trim();
  if (!s0) return "";

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) return s0;

  // Numeric formats: 06/23/1979 or 6-23-1979
  const m1 = s0.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const mm = String(m1[1]).padStart(2, "0");
    const dd = String(m1[2]).padStart(2, "0");
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Month name formats: "June 23 1979", "Jun 23, 1979"
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

  const cleaned = s0
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split(" ");

  // "june 23 1979"
  if (parts.length >= 3) {
    const month = monthMap[parts[0]];
    const day = parts[1]?.replace(/\D/g, "");
    const year = parts[2]?.replace(/\D/g, "");
    if (month && day && year && year.length === 4) {
      return `${year}-${month}-${String(day).padStart(2, "0")}`;
    }
  }

  // Last resort: Date parser
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
  // Optional: if you proxy OD elsewhere (like local OD proxy), set OD_PROXY_BASE_URL
  if (OD_PROXY_BASE_URL) {
    const url = `${OD_PROXY_BASE_URL}?path=${encodeURIComponent(path)}`;
    return httpJson(url, { method: "GET" });
  }

  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL (or set OD_PROXY_BASE_URL instead).");
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

// ===============================
// Tools
// ===============================

async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();

  const dobInput = (params?.dateOfBirth || "").trim();
  const dobIso = normalizeDob(dobInput);

  const hasInput = Boolean(phone || firstName || lastName || dobInput);
  if (!hasInput) return { matches: [] };

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

    // If we successfully normalized DOB, enforce DOB match.
    // If we could not normalize DOB, don't block matching (rely on name/phone).
    const dobOk = dobIso ? String(p.Birthdate || "").startsWith(dobIso) : true;

    return phoneOk && fnOk && lnOk && dobOk;
  });

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
  const patNum = Number(params?.patNum);
  if (!patNum) throw new Error("patNum is required");

  const data = await odGet(`/appointments?patNum=${encodeURIComponent(String(patNum))}`);
  const list = Array.isArray(data) ? data : [];

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

// Tools 3–6 are intentionally stubbed for now
async function tool_getAvailability(params) {
  return { ok: false, error: "opendental_getAvailability not implemented yet", received: params };
}
async function tool_bookAppointment(params) {
  return { ok: false, error: "opendental_bookAppointment not implemented yet", received: params };
}
async function tool_rescheduleAppointment(params) {
  return { ok: false, error: "opendental_rescheduleAppointment not implemented yet", received: params };
}
async function tool_breakAppointment(params) {
  return { ok: false, error: "opendental_breakAppointment not implemented yet", received: params };
}

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
// Vapi handler
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

      results.push({ toolCallId, result: output });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log("Server listening on port", PORT));
}

// Converts "June 23 1979", "06/23/1979", "6-23-1979" -> "1979-06-23"
function normalizeDob(input) {
  const s0 = String(input || "").trim();
  if (!s0) return "";

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) return s0;

  // Numeric formats
  const m1 = s0.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const mm = String(m1[1]).padStart(2, "0");
    const dd = String(m1[2]).padStart(2, "0");
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Month name formats
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

  // "june 23 1979"
  if (parts.length >= 3) {
    const month = monthMap[parts[0]];
    const day = parts[1]?.replace(/\D/g, "");
    const year = parts[2]?.replace(/\D/g, "");
    if (month && day && year && year.length === 4) {
      return `${year}-${month}-${String(day).padStart(2, "0")}`;
    }
  }

  // Last resort: Date parser
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
  if (OD_PROXY_BASE_URL) {
    const url = `${OD_PROXY_BASE_URL}?path=${encodeURIComponent(path)}`;
    return httpJson(url, { method: "GET" });
  }

  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL (or set OD_PROXY_BASE_URL instead).");
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

// -------------------------------
// Tools
// -------------------------------

async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();

  const dobInput = (params?.dateOfBirth || "").trim();
  const dobIso = normalizeDob(dobInput);

  const hasInput = Boolean(phone || firstName || lastName || dobInput);
  if (!hasInput) return { matches: [] };

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

    // If we successfully normalized DOB, enforce DOB match.
    // If not, don’t block matching (we’ll rely on name/phone)
    const dobOk = dobIso ? String(p.Birthdate || "").startsWith(dobIso) : true;

    return phoneOk && fnOk && lnOk && dobOk;
  });

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
  const patNum = Number(params?.patNum);
  if (!patNum) throw new Error("patNum is required");

  let path = `/appointments?patNum=${encodeURIComponent(String(patNum))}`;

  const data = await odGet(path);
  const list = Array.isArray(data) ? data : [];

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

async function tool_getAvailability(params) {
  return { ok: false, error: "opendental_getAvailability not implemented yet", received: params };
}
async function tool_bookAppointment(params) {
  return { ok: false, error: "opendental_bookAppointment not implemented yet", received: params };
}
async function tool_rescheduleAppointment(params) {
  return { ok: false, error: "opendental_rescheduleAppointment not implemented yet", received: params };
}
async function tool_breakAppointment(params) {
  return { ok: false, error: "opendental_breakAppointment not implemented yet", received: params };
}

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

// -------------------------------
// Vapi handler
// -------------------------------

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

      results.push({ toolCallId, result: output });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log("Server listening on port", PORT));
// ===============================
// Helpers
// ===============================

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

// Convert many DOB formats into YYYY-MM-DD
function normalizeDob(input) {
  const s0 = String(input || "").trim();
  if (!s0) return "";

  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s0)) return s0;

  // Common spoken formats: "06/23/1979" or "6-23-1979"
  const m1 = s0.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const mm = String(m1[1]).padStart(2, "0");
    const dd = String(m1[2]).padStart(2, "0");
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Month name formats: "June 23 1979", "Jun 23, 1979"
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

  const cleaned = s0
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // e.g. "june 23 1979"
  const parts = cleaned.split(" ");
  if (parts.length >= 3) {
    const month = monthMap[parts[0]];
    const day = parts[1]?.replace(/\D/g, "");
    const year = parts[2]?.replace(/\D/g, "");
    if (month && day && year && year.length === 4) {
      const dd = String(day).padStart(2, "0");
      return `${year}-${month}-${dd}`;
    }
  }

  // Last resort: try Date parse (can be unreliable, but helps)
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
  if (OD_PROXY_BASE_URL) {
    const url = `${OD_PROXY_BASE_URL}?path=${encodeURIComponent(path)}`;
    return httpJson(url, { method: "GET" });
  }

  if (!OD_BASE_URL) throw new Error("Missing OD_BASE_URL (or set OD_PROXY_BASE_URL instead).");
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

// ===============================
// Tool implementations
// ===============================

async function tool_findPatient(params) {
  const phone = digitsOnly(params?.phone);
  const firstName = (params?.firstName || "").trim();
  const lastName = (params?.lastName || "").trim();

  // Normalize DOB into YYYY-MM-DD for matching Open Dental Birthdate
  const dateOfBirthRaw = (params?.dateOfBirth || "").trim();
  const dateOfBirth = normalizeDob(dateOfBirthRaw);

  const hasInput = Boolean(phone || firstName || lastName || dateOfBirthRaw);
  if (!hasInput) return { matches: [] };

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

    // If we could normalize DOB, match against YYYY-MM-DD start
    // If we could NOT normalize, we don't block by DOB (we just rely on name/phone)
    const dobOk = dateOfBirth
      ? String(p.Birthdate || "").startsWith(dateOfBirth)
      : true;

    return phoneOk && fnOk && lnOk && dobOk;
  });

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
  const patNum = Number(params?.patNum);
  if (!patNum) throw new Error("patNum is required");

  const dateFrom = (params?.dateFrom || "").trim();
  const dateTo = (params?.dateTo || "").trim();

  let path = `/appointments?patNum=${encodeURIComponent(String(patNum))}`;
  if (dateFrom) path += `&dateFrom=${encodeURIComponent(dateFrom)}`;
  if (dateTo) path += `&dateTo=${encodeURIComponent(dateTo)}`;

  const data = await odGet(path);
  const list = Array.isArray(data) ? data : [];

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

// Tools 3–6 stubs for now
async function tool_getAvailability(params) {
  return { ok: false, error: "opendental_getAvailability not implemented yet", received: params };
}
async function tool_bookAppointment(params) {
  return { ok: false, error: "opendental_bookAppointment not implemented yet", received: params };
}
async function tool_rescheduleAppointment(params) {
  return { ok: false, error: "opendental_rescheduleAppointment not implemented yet", received: params };
}
async function tool_breakAppointment(params) {
  return { ok: false, error: "opendental_breakAppointment not implemented yet", received: params };
}

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
// Vapi handler
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

      results.push({ toolCallId, result: output });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log("Server listening on port", PORT));
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
