import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3000;
const VERSION = "reset-clean-2";

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

