#!/usr/bin/env bun
// Stand-in for code-server in tests: same CLI flags, loopback HTTP + WebSocket echo.
// Like code-server, it refuses sockets whose Origin does not match its own host.
const args = process.argv.slice(2);
const bind = args[args.indexOf("--bind-addr") + 1] ?? "127.0.0.1:0";
const [hostname, port] = bind.split(":");
const folder = args.at(-1) ?? "";

Bun.serve<{ path: string }>({
  hostname,
  port: Number(port),
  fetch(req, server) {
    const url = new URL(req.url);
    if (req.headers.get("upgrade") === "websocket") {
      const origin = req.headers.get("origin") ?? "";
      if (new URL(origin || "http://none").host !== url.host)
        return new Response("bad origin", { status: 403 });
      return server.upgrade(req, { data: { path: url.pathname } })
        ? undefined
        : new Response("no", { status: 400 });
    }
    if (url.pathname === "/healthz") return Response.json({ status: "alive" });
    if (url.pathname === "/")
      return Response.redirect("./?folder=" + encodeURIComponent(folder), 302);
    return new Response(`<title>fake code-server</title>folder=${folder} path=${url.pathname}`, {
      headers: { "content-type": "text/html" },
    });
  },
  websocket: {
    message(ws, message) {
      ws.send(`echo:${ws.data.path}:${message}`);
    },
  },
});
