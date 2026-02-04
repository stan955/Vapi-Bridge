app.post("/vapi/opendental_getAvailableTimes", authMiddleware, async (req, res) => {
  try {
    const args = extractToolArgs(req.body);

    const dateStart = (args.dateStart || "").trim();
    const dateEnd = (args.dateEnd || "").trim();
    const lengthMinutes = args.lengthMinutes ?? args.length ?? 40;

    const provNum = Number(args.provNum ?? args.ProvNum ?? DEFAULT_PROV_NUM ?? 1);
    const opNum = Number(args.opNum ?? args.OpNum ?? DEFAULT_OP_NUM ?? 1);

    if (!dateStart || !dateEnd) {
      return res.json({
        ok: false,
        result: "Please provide a date start and date end in YYYY-MM-DD format.",
      });
    }

    const qs = new URLSearchParams();
    qs.set("dateStart", dateStart);
    qs.set("dateEnd", dateEnd);
    qs.set("lengthMinutes", String(lengthMinutes));
    qs.set("ProvNum", String(provNum));
    qs.set("OpNum", String(opNum));

    const out = await odFetch(`/appointments/Slots?${qs.toString()}`);

    if (!out.ok) {
      return res.json({
        ok: false,
        result: "I couldn’t pull up availability right now.",
        status: out.status,
        url: out.url,
        raw: out.raw,
      });
    }

    const slots = Array.isArray(out.data) ? out.data : [];
    if (!slots.length) {
      return res.json({
        ok: true,
        result: "I don’t see any open times in that date range.",
        slots: [],
      });
    }

    // Sort by earliest start time
    slots.sort((a, b) => new Date(a.DateTimeStart) - new Date(b.DateTimeStart));

    const first = slots[0];

    // Make a simple speakable summary of the first 3
    const top = slots.slice(0, 3).map((s) => {
      const d = new Date(s.DateTimeStart);
      const dateStr = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `${dateStr} at ${timeStr}`;
    });

    const result =
      top.length === 1
        ? `The first available time is ${top[0]}. Would you like to book it?`
        : `The first available times are ${top[0]}, ${top[1]}, or ${top[2]}. Which one would you like?`;

    return res.json({
      ok: true,
      result,
      firstSlot: first,
      slots,
      status: out.status,
      url: out.url,
    });
  } catch (e) {
    return res.json({ ok: false, result: "Something went wrong while checking availability.", error: e.message });
  }
});
