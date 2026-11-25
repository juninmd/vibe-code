/**
 * Reverse proxy /vscode/<taskId>/* → the session's code-server on loopback.
 *
 * Browsers cannot send the API key header on page loads, so the app asks
 * POST /api/vscode/tasks/:id for a one-time ticket; the first request
 * redeems it for an httpOnly cookie scoped to that session's path. A valid
 * login session cookie also passes.
 */
import type { Server, ServerWebSocket } from "bun";
import { randomToken } from "../oauth/common";
import type { VsCodeService } from "./service";

const COOKIE = "vibe_vscode";
const TICKET_TTL_MS = 60_000;
const ACCESS_TTL_MS = 12 * 60 * 60_000;
const PATH = /^\/vscode\/([A-Za-z0-9_-]{1,64})(\/.*)?$/;
const HOP_HEADERS = ["host", "connection", "upgrade", "keep-alive", "transfer-encoding", "cookie"];

export interface VsCodeSocketData {
  kind: "vscode";
  taskId: string;
  target: string;
  origin: string;
  protocols: string[];
  upstream?: WebSocket;
  queue?: (string | ArrayBufferLike | Uint8Array)[];
}

interface Grant {
  taskId: string;
  expiresAt: number;
}

export class VsCodeProxy {
  private tickets = new Map<string, Grant>();
  private access = new Map<string, Grant>();

  constructor(
    private service: VsCodeService,
    private isAuthenticated: (req: Request) => boolean,
    private now: () => number = Date.now
  ) {}

  /** One-time ticket the browser exchanges for the session cookie. */
  issueTicket(taskId: string): string {
    this.prune();
    const ticket = randomToken();
    this.tickets.set(ticket, { taskId, expiresAt: this.now() + TICKET_TTL_MS });
    return ticket;
  }

  private take(map: Map<string, Grant>, token: string | undefined, taskId: string, once: boolean) {
    if (!token) return false;
    const grant = map.get(token);
    if (once) map.delete(token);
    return Boolean(grant && grant.taskId === taskId && grant.expiresAt > this.now());
  }

  private prune(): void {
    const now = this.now();
    for (const map of [this.tickets, this.access]) {
      for (const [token, grant] of map) if (grant.expiresAt <= now) map.delete(token);
    }
  }

  static matches(pathname: string): boolean {
    return PATH.test(pathname);
  }

  private cookieToken(req: Request): string | undefined {
    const header = req.headers.get("cookie") ?? "";
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === COOKIE) return rest.join("=");
    }
    return undefined;
  }

  async handle(req: Request, server: Server<VsCodeSocketData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    const match = url.pathname.match(PATH);
    if (!match) return new Response("Not found", { status: 404 });
    const [, taskId, rest = "/"] = match;
    const base = `/vscode/${taskId}/`;

    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      if (!this.take(this.tickets, ticket, taskId, true)) {
        return new Response("Link do VS Code expirado. Abra de novo pelo app.", { status: 401 });
      }
      const token = randomToken();
      this.access.set(token, { taskId, expiresAt: this.now() + ACCESS_TTL_MS });
      url.searchParams.delete("ticket");
      const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${base}${url.search}`,
          "Set-Cookie": `${COOKIE}=${token}; Path=${base}; HttpOnly; SameSite=Lax; Max-Age=${ACCESS_TTL_MS / 1000}${secure ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        },
      });
    }

    const allowed =
      this.take(this.access, this.cookieToken(req), taskId, false) || this.isAuthenticated(req);
    if (!allowed) return new Response("Faça login no app para abrir o VS Code.", { status: 401 });
    // Without the trailing slash, relative asset URLs would resolve one level up.
    if (!match[2]) return Response.redirect(`${base}${url.search}`, 302);

    const port = this.service.target(taskId);
    if (!port) {
      return new Response("O VS Code desta sessão está parado. Abra de novo pelo app.", {
        status: 404,
      });
    }

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const upgraded = server.upgrade(req, {
        data: {
          kind: "vscode",
          taskId,
          target: `ws://127.0.0.1:${port}${rest}${url.search}`,
          origin: `http://127.0.0.1:${port}`,
          protocols,
        },
        headers: protocols[0] ? { "Sec-WebSocket-Protocol": protocols[0] } : undefined,
      });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    const headers = new Headers(req.headers);
    for (const name of HOP_HEADERS) headers.delete(name);
    const upstream = await fetch(`http://127.0.0.1:${port}${rest}${url.search}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    }).catch(() => null);
    if (!upstream) return new Response("code-server indisponível", { status: 502 });
    const out = new Headers(upstream.headers);
    const location = out.get("location");
    // code-server answers with absolute paths for its own root: keep them under the prefix.
    if (location?.startsWith("/")) out.set("location", `${base}${location.slice(1)}`);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  open(ws: ServerWebSocket<VsCodeSocketData>): void {
    const data = ws.data;
    data.queue = [];
    this.service.socketOpened(data.taskId);
    // Bun's client accepts headers; code-server checks Origin against its own host.
    const upstream = new WebSocket(data.target, {
      headers: { Origin: data.origin },
      protocols: data.protocols,
    } as unknown as string[]);
    upstream.binaryType = "arraybuffer";
    data.upstream = upstream;
    upstream.onopen = () => {
      for (const message of data.queue ?? []) upstream.send(message);
      data.queue = undefined;
    };
    upstream.onmessage = (event) => ws.send(event.data as string | ArrayBuffer);
    upstream.onclose = (event) =>
      // 1005/1006 are reserved and cannot be sent on a close frame.
      ws.close(event.code === 1000 || event.code >= 3000 ? event.code : 1000, event.reason);
    upstream.onerror = () => ws.close(1011, "upstream error");
  }

  message(ws: ServerWebSocket<VsCodeSocketData>, message: string | Buffer): void {
    const { upstream, queue } = ws.data;
    this.service.target(ws.data.taskId);
    if (queue) queue.push(message);
    else if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
  }

  close(ws: ServerWebSocket<VsCodeSocketData>): void {
    this.service.socketClosed(ws.data.taskId);
    const upstream = ws.data.upstream;
    if (upstream && upstream.readyState <= WebSocket.OPEN) upstream.close();
  }
}

export function isVsCodeSocket(data: unknown): data is VsCodeSocketData {
  return (data as VsCodeSocketData | undefined)?.kind === "vscode";
}
