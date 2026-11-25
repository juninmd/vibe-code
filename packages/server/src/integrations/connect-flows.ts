import { PendingFlows } from "../oauth/common";

/** An OAuth "connect" started from Settings → MCP by an authenticated user. */
export type ConnectFlow =
  | { provider: "github" }
  | { provider: "gitlab"; verifier: string; baseUrl: string; redirectUri: string };

export type ConnectFlows = PendingFlows<ConnectFlow>;

export function createConnectFlows(): ConnectFlows {
  return new PendingFlows<ConnectFlow>();
}
