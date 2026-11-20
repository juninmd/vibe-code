import { readFileSync } from "node:fs";

/** The few Kubernetes calls the runner makes; a fake implements it in tests. */
export interface KubeApi {
  createPod(namespace: string, pod: object): Promise<KubePod>;
  getPod(namespace: string, name: string): Promise<KubePod | null>;
  listPods(namespace: string, labelSelector: string): Promise<KubePod[]>;
  deletePod(namespace: string, name: string): Promise<void>;
  createSecret(namespace: string, secret: object): Promise<void>;
  patchSecretOwner(namespace: string, name: string, owner: OwnerRef): Promise<void>;
  deleteSecret(namespace: string, name: string): Promise<void>;
}

export interface OwnerRef {
  apiVersion: "v1";
  kind: "Pod";
  name: string;
  uid: string;
}

export interface KubePod {
  metadata: { name: string; uid?: string; labels?: Record<string, string> };
  status?: {
    phase?: string;
    podIP?: string;
    conditions?: { type: string; status: string }[];
    containerStatuses?: { state?: { waiting?: { reason?: string; message?: string } } }[];
  };
}

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
type Fetch = (url: string, init: RequestInit & { tls?: { ca?: string } }) => Promise<Response>;

/** REST client for the in-cluster API server, authenticated with the pod's ServiceAccount. */
export class InClusterKubeApi implements KubeApi {
  constructor(
    private readonly base: string,
    private readonly token: () => string,
    private readonly ca: string | undefined,
    private readonly fetchImpl: Fetch = fetch as Fetch
  ) {}

  static fromEnvironment(env: Record<string, string | undefined> = process.env): InClusterKubeApi {
    const host = env.KUBERNETES_SERVICE_HOST;
    const port = env.KUBERNETES_SERVICE_PORT || "443";
    if (!host) throw new Error("VIBE_AGENT_RUNNER=k8s must run inside a Kubernetes pod");
    const bracketed = host.includes(":") ? `[${host}]` : host;
    // The projected token rotates; read it per request.
    return new InClusterKubeApi(
      `https://${bracketed}:${port}`,
      () => readFileSync(`${SA_DIR}/token`, "utf8").trim(),
      readFileSync(`${SA_DIR}/ca.crt`, "utf8")
    );
  }

  private async call(method: string, path: string, body?: object, contentType?: string) {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token()}`,
        accept: "application/json",
        ...(body ? { "content-type": contentType ?? "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      tls: this.ca ? { ca: this.ca } : undefined,
    });
    return response;
  }

  private async json<T>(method: string, path: string, body?: object, contentType?: string) {
    const response = await this.call(method, path, body, contentType);
    if (!response.ok) throw await kubeError(method, path, response);
    return (await response.json()) as T;
  }

  private async ignoreMissing(method: string, path: string) {
    const response = await this.call(method, path);
    if (!response.ok && response.status !== 404) throw await kubeError(method, path, response);
  }

  createPod(namespace: string, pod: object) {
    return this.json<KubePod>("POST", `/api/v1/namespaces/${enc(namespace)}/pods`, pod);
  }

  async getPod(namespace: string, name: string) {
    const response = await this.call(
      "GET",
      `/api/v1/namespaces/${enc(namespace)}/pods/${enc(name)}`
    );
    if (response.status === 404) return null;
    if (!response.ok) throw await kubeError("GET", `pods/${name}`, response);
    return (await response.json()) as KubePod;
  }

  async listPods(namespace: string, labelSelector: string) {
    const query = `labelSelector=${encodeURIComponent(labelSelector)}&limit=500`;
    const list = await this.json<{ items: KubePod[] }>(
      "GET",
      `/api/v1/namespaces/${enc(namespace)}/pods?${query}`
    );
    return list.items;
  }

  deletePod(namespace: string, name: string) {
    return this.ignoreMissing("DELETE", `/api/v1/namespaces/${enc(namespace)}/pods/${enc(name)}`);
  }

  async createSecret(namespace: string, secret: object) {
    await this.json("POST", `/api/v1/namespaces/${enc(namespace)}/secrets`, secret);
  }

  async patchSecretOwner(namespace: string, name: string, owner: OwnerRef) {
    await this.json(
      "PATCH",
      `/api/v1/namespaces/${enc(namespace)}/secrets/${enc(name)}`,
      { metadata: { ownerReferences: [owner] } },
      "application/merge-patch+json"
    );
  }

  deleteSecret(namespace: string, name: string) {
    return this.ignoreMissing(
      "DELETE",
      `/api/v1/namespaces/${enc(namespace)}/secrets/${enc(name)}`
    );
  }
}

const enc = encodeURIComponent;

async function kubeError(method: string, path: string, response: Response): Promise<Error> {
  let reason = response.statusText;
  try {
    const status = (await response.json()) as { message?: string };
    if (status.message) reason = status.message;
  } catch {
    // Not a Status object.
  }
  // Path and reason only: request bodies carry the per-pod Secret.
  return new Error(`kubernetes ${method} ${path} failed (${response.status}): ${reason}`);
}
