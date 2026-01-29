import express from "express";

const app = express();
app.use(express.json());

// Health check (Render will hit this)
app.get("/", (req, res) => {
  res.send("alive");
});

// ONE endpoint Vapi will call
app.post("/vapi", (req, res) => {
  const toolCallList = req.body?.message?.toolCallList || [];

  const results = toolCallList.map(toolCall => {
    return {
      toolCallId: toolCall.id,
      result: {
        ok: true,
        toolName: toolCall.name,
        receivedParameters: toolCall.parameters
      }
    };
  });

  res.json({ results });
});

// Render provides the PORT automatically
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
