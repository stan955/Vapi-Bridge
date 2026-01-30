import express from "express";
import cors from "cors";

const app = express();

// CORS (so Vapi browser tester can hit your endpoint)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Handle preflight requests
app.options("*", cors());

app.use(express.json());

// Simple request logger (helps confirm Vapi is hitting you)
app.use((req, res, next) => {
  console.log("INCOMING:", req.method, req.url);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.send("alive");
});

// ONE endpoint Vapi will call
app.post("/vapi", (req, res) => {
  const toolCallList = req.body?.message?.toolCallList || [];

  const results = toolCallList.map((toolCall) => {
    return {
      toolCallId: toolCall.id,
      result: {
        ok: true,
        toolName: toolCall.name,
        receivedParameters: toolCall.parameters,
      },
    };
  });

  res.json({ results });
});

// Render provides the PORT automatically
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
