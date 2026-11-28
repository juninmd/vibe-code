import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isVsCodeSocket, VsCodeProxy, type VsCodeSocketData } from "./proxy";
import { codeServerArgs, codeServerEnv, VsCodeService } from "./service";

const FAKE = resolve(import.meta.dir, "../../test-fixtures/fake-code-server.ts");

describe("code-server launch", () => {
  it("binds to loopback with auth off (the proxy is the only door)", () => {
    const args = codeServerArgs("code-server", 4100, "/data", "/work/tree");
    expect(args).toContain("127.0.0.1:4100");
    expect(args.slice(args.indexOf("--auth"), args.indexOf("--auth") + 2)).toEqual([
      "--auth",
      "none",
    ]);
    expect(args.at(-1)).toBe("/work/tree");
  });
});

describe("code-server env", () => {
  it("drops the server's PORT, which code-server would bind instead of --bind-addr", () => {
    expect(codeServerEnv({ PORT: "3000", HOME: "/h" }, "/w")).toEqual({ HOME: "/h", PWD: "/w" });
  });
});

describe("VS Code reverse proxy", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "vscode-test-"));
  const folder = mkdtempSync(join(tmpdir(), "vscode-folder-"));
  const service = new VsCodeService({ dataDir, binary: FAKE, maxInstances: 2 });
  let loggedIn = false;
  const proxy = new VsCodeProxy(service, () => loggedIn);
  let server: ReturnType<typeof Bun.serve>;
  let base = "";

  beforeAll(async () => {
    server = Bun.serve<VsCodeSocketData>({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, srv) => proxy.handle(req, srv as never),
      websocket: {
        open: (ws) => (isVsCodeSocket(ws.data) ? proxy.open(ws) : undefined),
        message: (ws, msg) => proxy.message(ws, msg),
        close: (ws) => proxy.close(ws),
      },
    });
    base = `http://127.0.0.1:${server.port}`;
    await service.ensure("t1", folder);
  });

  afterAll(() => {
    service.stopAll();
    server.stop(true);
  });

  it("refuses requests without a ticket, cookie or login", async () => {
    const res = await fetch(`${base}/vscode/t1/`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });

  it("trades a one-time ticket for a cookie scoped to that session", async () => {
    const ticket = proxy.issueTicket("t1");
    const res = await fetch(`${base}/vscode/t1/?ticket=${ticket}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/vscode/t1/");
    const again = await fetch(`${base}/vscode/t1/?ticket=${ticket}`, { redirect: "manual" });
    expect(again.status).toBe(401);

    const token = cookie.split(";")[0];
    const page = await fetch(`${base}/vscode/t1/static/app.js`, { headers: { cookie: token } });
    expect(await page.text()).toContain(`folder=${folder} path=/static/app.js`);
    // The same cookie does not open another session's editor.
    const other = await fetch(`${base}/vscode/t2/`, {
      headers: { cookie: token },
      redirect: "manual",
    });
    expect(other.status).toBe(401);
  });

  it("keeps code-server's relative redirect under the prefix", async () => {
    loggedIn = true;
    const res = await fetch(`${base}/vscode/t1/`, { redirect: "manual" });
    loggedIn = false;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toStartWith("./?folder=");
  });

  it("bridges WebSockets with the Origin code-server expects", async () => {
    loggedIn = true;
    const ws = new WebSocket(`${base.replace("http", "ws")}/vscode/t1/sock`);
    const reply = await new Promise<string>((done, fail) => {
      ws.onopen = () => ws.send("ping");
      ws.onmessage = (event) => done(String(event.data));
      ws.onerror = () => fail(new Error("socket error"));
      setTimeout(() => fail(new Error("timeout")), 5_000);
    });
    ws.close();
    loggedIn = false;
    expect(reply).toBe("echo:/sock:ping");
  });

  it("answers 404 once the instance is stopped", async () => {
    await service.ensure("t-stop", folder);
    service.stop("t-stop");
    loggedIn = true;
    const res = await fetch(`${base}/vscode/t-stop/`, { redirect: "manual" });
    loggedIn = false;
    expect(res.status).toBe(404);
  });
});
