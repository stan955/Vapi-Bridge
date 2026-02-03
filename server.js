import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

/* =========================
   BASIC SERVER SETUP
========================= */

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  console.log("REQ", req.method, req.path);
  next();
});

const PORT = process.env.PORT || 10000;

/* =========================
   ENV VARIABLES
========================= */

const OD_BASE_URL = process.env.OD_BASE_URL;
const OD_AUTH_HEADER = process.env.OD_AUTH_HEADER;

/* =========================
   HEALTH CHECK
========================= */

app.get("/alive", (req, res) => {
  res.status(200).send("alive");
});

/* =========================
   HELPER: OPEN DENTAL FETCH
========================= */

async function odFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${OD_BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: OD_AUTH_HEADER,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const text = await response.text();
    clearTimeout(timeout);

    return {
      status: response.status,
      body: text
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/* =========================
   TOOL: FIND PATIENT
========================= */

app.post("/vapi/opendental_findPatient", async (req, res) => {
  try {
    const { lastName } = req.body;

    if (!lastName) {
      return res.status(200).json({ ok: false, error: "lastName required" });
    }

    const r = await odFetch(`/patients?LName=${encodeURIComponent(lastName)}`);
    return res.status(200).json({ ok: true, data: JSON.parse(r.body) });
  } catch (e) {
    console.error("findPatient error", e);
    return res.status(200).json({ ok: false, error: String(e) });
  }
});

/* =========================
   TOOL: GET AVAILABLE TIMES
========================= */

app.post("/vapi/opendental_getAvailableTimes", async (req, res) => {
  try {
    console.log("Availability request body:", req.body);

    /* 
       IMPORTANT:
       Replace this endpoint with your REAL Open Dental availability logic.
       This placeholder ensures Vapi ALWAYS gets JSON back.
    */

    const r = await odFetch("/appointments");

    return res.status(200).json({
      ok: true,
      data: JSON.parse(r.body)
    });
  } catch (e) {
    console.error("getAvailableTimes error", e);
    return res.status(200).json({
      ok: false,
      error: String(e)
    });
  }
});

/* =========================
   TOOL: CREATE APPOINTMENT
========================= */

app.post("/vapi/opendental_createAppointment", async (req, res) => {
  try {
    const r = await odFetch("/appointments", {
      method: "POST",
      body: JSON.stringify(req.body)
    });

    return res.status(200).json({
      ok: true,
      data: JSON.parse(r.body)
    });
  } catch (e) {
    console.error("createAppointment error", e);
    return res.status(200).json({ ok: false, error: String(e) });
  }
});

/* =========================
   TOOL: GET UPCOMING APPTS
========================= */

app.post("/vapi/opendental_getUpcomingAppointments", async (req, res) => {
  try {
    const r = await odFetch("/appointments");

    return res.status(200).json({
      ok: true,
      data: JSON.parse(r.body)
    });
  } catch (e) {
    console.error("getUpcomingAppointments error", e);
    return res.status(200).json({ ok: false, error: String(e) });
  }
});

/* =========================
   TOOL: RESCHEDULE APPT
========================= */

app.post("/vapi/opendental_rescheduleAppointment", async (req, res) => {
  try {
    const r = await odFetch("/appointments", {
      method: "PUT",
      body: JSON.stringify(req.body)
    });

    return res.status(200).json({
      ok: true,
      data: JSON.parse(r.body)
    });
  } catch (e) {
    console.error("rescheduleAppointment error", e);
    return res.status(200).json({ ok: false, error: String(e) });
  }
});

/* =========================
   TOOL: CANCEL APPT
========================= */

app.post("/vapi/opendental_cancelAppointment", async (req, res) => {
  try {
    const r = await odFetch("/appointments", {
      method: "DELETE",
      body: JSON.stringify(req.body)
    });

    return res.status(200).json({
      ok: true,
      data: JSON.parse(r.body)
    });
  } catch (e) {
    console.error("cancelAppointment error", e);
    return res.status(200).json({ ok: false, error: String(e) });
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
