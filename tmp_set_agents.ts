const r = await fetch("http://localhost:3002/api/settings", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: "vibe_session=vibe-auto-session-2026" },
  body: JSON.stringify({ maxAgents: 20 }),
});
console.log(r.status, JSON.stringify(await r.json()));
