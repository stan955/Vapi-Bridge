import express from "express";
import cors from "cors";

const app = express();

// CORS (lets Vapi browser-based tool tester call your endpoint)
app.use(
  cors({
    origin: true, // allow all origins
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight
app.options("*", cors());

// Parse JSON
app.use(express.json({ limit: "2mb" }));

// Simple request logger (shows in Render logs)
app.use((req, res, next) => {
  console.log("INCOMING:", req.method, req.url);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.status(200).send("alive");
});

// Vapi tool webhook endpoint
app.post("/vapi", (req, res) => {
  try {
    const toolCallList = req.body?.message?.toolCallList || [];

    console.log("toolCallList length:", toolCallList.length);

    const results = toolCallList.map((toolCall) => ({
      toolCallId: toolCall.id,
      result: {
        ok: true,
        toolName: toolCall.name,
        receivedParameters: toolCall.parameters,
      },
    }));

    return res.status(200).json({ results });
  } catch (err) {
    console.error("ERROR in /vapi:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Render provides PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on port", PORT));

