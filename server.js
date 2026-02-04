import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const VERSION = process.env.VERSION || "vapi-bridge-clean-v1";

// Optional: protect /vapi routes with bearer token (leave blank to disable)
const BRIDGE_BEARER_TOKEN = (process.env.BRIDGE_BEARER_TOKEN || "").trim();

// Open Dental API settings (Render Environment Variables)
const OD_BASE_URL = (process.env.OD_BASE_URL || "").trim(); // e.g. https://api.opendental.com/api/v1
const OD_AUTH_HEADER = (process.env.OD_AUTH_HEADER || "").trim(); // e.g. ODFHIR devKey/customerKey  (whatever your working format is)

function mask(s) {
  if (!s) return "";
  if (s.length <= 8) return "***";
  return s.slice(0, 4) + "..." + s.slice(-4);
}

function requireBearer(req, res) {
  if (!BRIDGE_BEARER_TOKEN) return true;
  const auth = (req.headers.authorization || "").trim();
  if (!auth || auth !== `Bearer ${BRIDGE_BEARER_TOKEN}`) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

async function odFetch(path, options = {}) {
  if (!OD_BASE_URL) throw new Error("OD_BASE_URL is not set");
  if (!OD_AUTH_HEADER) throw new Error("OD_AUTH_HEADER is not set");

  const url = `${OD_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = {
    "Content-Type": "application/json",
    "Authorization": OD_AUTH_HEADER,
    ...(options.headers || {})
  };

  const resp = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: resp.status, ok: resp.ok, text, json, url };
}

function vapiOk(res, result, extra = {}) {
  // Vapi-friendly: always include a top-level "result" string
  return res.status(200).json({ ok: true, result, ...extra });
}

function vapiFail(res, result, extra = {}, httpStatus = 200) {
  // Keep HTTP 200 so Vapi reliably reads body; signal failure via ok:false
  return res.status(httpStatus).json({ ok: false, result, ...extra });
}

// ---------- Health / Debug ----------
app.get("/alive", (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    hasBearer: !!BRIDGE_BEARER_TOKEN,
    odBaseUrl: OD_BASE_URL,
    odAuthHeaderPresent: !!OD_AUTH_HEADER,
    odAuthHeaderMasked: mask(OD_AUTH_HEADER)
  });
});

// Browser-friendly test: /od/try?path=/patients?LName=Smith
app.get("/od/try", async (req, res) => {
  const path = req.query.path;
  if (!path || typeof path !== "string") {
    return res.status(400).json({ ok: false, error: "Provide ?path=/..." });
  }
  try {
    const r = await odFetch(path, { method: "GET" });
    return res.status(200).json({
      ok: true,
      path,
      status: r.status,
      url: r.url,
      data: r.json ?? r.text
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// ---------- Helpers ----------
function normalizeLastName(input) {
  if (!input) return "";
  let s = String(input).trim();

  // Remove titles and punctuation
  s = s.replace(/\b(mr|mrs|ms|dr)\.?\b/gi, "").trim();
  s = s.replace(/[.,;:"'`]/g, "").trim();

  // If someone spelled letters: "d u r s t" -> "durst"
  if (/^([a-zA-Z]\s+){2,}[a-zA-Z]$/.test(s)) {
    s = s.replace(/\s+/g, "");
  }

  // If full name given, take last token
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length > 1) s = parts[parts.length - 1];

  // Capitalize
  s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return s;
}

// ---------- Vapi Tool Routes ----------
app.post("/vapi/opendental_findPatient", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    const payload = req.body || {};
    const toolCall =
      payload?.message?.toolCalls?.[0] ||
      payload?.message?.toolCallList?.[0] ||
      null;

    const args = toolCall?.function?.arguments || toolCall?.arguments || payload || {};
    const lastNameRaw = args.lastName || args.LName || args.lname;

    const lastName = normalizeLastName(lastNameRaw);
    if (!lastName) {
      return vapiFail(res, "I didn’t catch the last name. What is your last name?");
    }

    const r = await odFetch(`/patients?LName=${encodeURIComponent(lastName)}`, { method: "GET" });

    if (!r.ok) {
      return vapiFail(
        res,
        "I’m having trouble reaching the scheduling system right now.",
        { status: r.status, raw: r.json ?? r.text }
      );
    }

    const list = Array.isArray(r.json) ? r.json : r.json?.data || r.json;
    const patients = Array.isArray(list) ? list : [];

    if (patients.length === 0) {
      return vapiOk(res, `I don’t see anyone with the last name ${lastName}. Are you a new patient?`, {
        patients: []
      });
    }

    if (patients.length === 1) {
      const p = patients[0];
      return vapiOk(res, `Found ${p.FName} ${p.LName}.`, {
        patients,
        patNum: p.PatNum
      });
    }

    return vapiOk(res, `I found multiple patients with the last name ${lastName}. What is the date of birth?`, {
      patients
    });
  } catch (e) {
    return vapiFail(res, "Something went wrong while searching for the patient.", { error: e.message });
  }
});

app.post("/vapi/opendental_getAvailableTimes", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    // IMPORTANT: You must adjust the OD endpoint used here to match your Open Dental API for availability.
    // We'll start by calling a placeholder endpoint you can replace once confirmed.
    //
    // For now, return a clear message so Vapi never says "No result returned".
    // Then we can wire the exact availability endpoint you want.

    // If you already have an availability endpoint working in your old code, paste it here.
    return vapiOk(
      res,
      "I can check availability, but the availability endpoint still needs to be mapped to your Open Dental API configuration.",
      { hint: "Once you confirm the exact Open Dental availability endpoint and required params, we’ll wire it in." }
    );
  } catch (e) {
    return vapiFail(res, "Something went wrong while checking availability.", { error: e.message });
  }
});

app.post("/vapi/opendental_createAppointment", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    // NOTE: appointment creation also needs exact endpoint + required fields.
    return vapiOk(
      res,
      "Appointment creation is connected, but the create endpoint and required fields still need to be mapped to your Open Dental API configuration.",
      { hint: "Next step is wiring the exact create appointment payload (patNum, operatory, provider, start time, length, etc.)." }
    );
  } catch (e) {
    return vapiFail(res, "Something went wrong while creating the appointment.", { error: e.message });
  }
});

app.post("/vapi/opendental_getUpcomingAppointments", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    return vapiOk(
      res,
      "Upcoming appointments lookup is connected, but the endpoint mapping still needs to be finalized.",
      { hint: "We’ll wire the correct /appointments query once we confirm Open Dental’s exact schema in your tenant." }
    );
  } catch (e) {
    return vapiFail(res, "Something went wrong while checking upcoming appointments.", { error: e.message });
  }
});

app.post("/vapi/opendental_rescheduleAppointment", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    return vapiOk(
      res,
      "Rescheduling is connected, but the endpoint mapping still needs to be finalized.",
      { hint: "We’ll wire it after we confirm how appointment IDs and updates work in your Open Dental API." }
    );
  } catch (e) {
    return vapiFail(res, "Something went wrong while rescheduling.", { error: e.message });
  }
});

app.post("/vapi/opendental_cancelAppointment", async (req, res) => {
  if (!requireBearer(req, res)) return;

  try {
    return vapiOk(
      res,
      "Cancellation is connected, but the endpoint mapping still needs to be finalized.",
      { hint: "We’ll wire the correct cancel/update status endpoint once we confirm the correct fields." }
    );
  } catch (e) {
    return vapiFail(res, "Something went wrong while cancelling.", { error: e.message });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`listening on ${PORT} (${VERSION})`);
  console.log(`OD_BASE_URL=${OD_BASE_URL}`);
  console.log(`OD_AUTH_HEADER present=${!!OD_AUTH_HEADER} masked=${mask(OD_AUTH_HEADER)}`);
});
