import type { KubeApi, KubePod, OwnerRef } from "./api";

/** In-memory API server: pods become Ready after `readyAfter` polls. */
export class FakeKube implements KubeApi {
  pods = new Map<string, { manifest: any; polls: number; status?: KubePod["status"] }>();
  secrets = new Map<string, { manifest: any; owner?: OwnerRef }>();
  readyAfter = 1;
  nextIp = 1;
  failWith?: { reason: string; message?: string };
  /** Runs inside getPod, before it answers: lets tests interleave pool calls. */
  onGetPod?: () => Promise<void>;
  failDeletes = 0;
  /** Condition a not-yet-ready pod reports (e.g. PodScheduled=False). */
  pendingCondition?: { type: string; status: string; reason?: string; message?: string };

  /** Pods the namespace quota admits; createPod fails like the API server above it. */
  quotaPods = Number.POSITIVE_INFINITY;

  async createPod(_ns: string, pod: any): Promise<KubePod> {
    if (this.pods.size >= this.quotaPods) {
      throw new Error("POST pods: 403 exceeded quota: harness-remote, requested: pods=1");
    }
    this.pods.set(pod.metadata.name, { manifest: pod, polls: 0 });
    return { metadata: { name: pod.metadata.name, uid: `uid-${pod.metadata.name}` } };
  }
  async getPod(_ns: string, name: string): Promise<KubePod | null> {
    const hook = this.onGetPod;
    this.onGetPod = undefined;
    await hook?.();
    const pod = this.pods.get(name);
    if (!pod) return null;
    if (pod.status) return { metadata: { name }, status: pod.status };
    pod.polls++;
    if (this.failWith) {
      return {
        metadata: { name },
        status: { phase: "Pending", containerStatuses: [{ state: { waiting: this.failWith } }] },
      };
    }
    if (pod.polls <= this.readyAfter) {
      const conditions = this.pendingCondition ? [this.pendingCondition] : undefined;
      return { metadata: { name }, status: { phase: "Pending", conditions } };
    }
    pod.status = {
      phase: "Running",
      podIP: `10.0.0.${this.nextIp++}`,
      conditions: [{ type: "Ready", status: "True" }],
    };
    return { metadata: { name }, status: pod.status };
  }
  async listPods(): Promise<KubePod[]> {
    return [...this.pods.keys()].map((name) => ({ metadata: { name } }));
  }
  /** Runs inside deletePod, before it answers: lets tests interleave pool calls. */
  onDeletePod?: () => Promise<void>;

  async deletePod(_ns: string, name: string) {
    const hook = this.onDeletePod;
    this.onDeletePod = undefined;
    await hook?.();
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new Error("api blip");
    }
    this.pods.delete(name);
  }
  async createSecret(_ns: string, secret: any) {
    this.secrets.set(secret.metadata.name, { manifest: secret });
  }
  async patchSecretOwner(_ns: string, name: string, owner: OwnerRef) {
    const s = this.secrets.get(name);
    if (s) s.owner = owner;
  }
  async deleteSecret(_ns: string, name: string) {
    this.secrets.delete(name);
  }
}
