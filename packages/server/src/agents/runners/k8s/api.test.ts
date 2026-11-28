import { describe, expect, it } from "bun:test";
import { InClusterKubeApi } from "./api";

function api(responses: Response[]) {
  const calls: { url: string; init: any }[] = [];
  const client = new InClusterKubeApi(
    "https://k8s:443",
    () => "tok",
    "CA",
    async (url, init) => {
      calls.push({ url, init });
      return responses.shift() ?? new Response("{}");
    }
  );
  return { client, calls };
}

describe("InClusterKubeApi", () => {
  it("authenticates with the ServiceAccount token and the cluster CA", async () => {
    const { client, calls } = api([Response.json({ items: [] })]);
    await client.listPods("ns", "a=b");
    expect(calls[0].url).toBe(
      "https://k8s:443/api/v1/namespaces/ns/pods?labelSelector=a%3Db&limit=500"
    );
    expect(calls[0].init.headers.authorization).toBe("Bearer tok");
    expect(calls[0].init.tls).toEqual({ ca: "CA" });
  });

  it("treats a missing pod as null and a missing delete as done", async () => {
    const { client } = api([new Response("", { status: 404 }), new Response("", { status: 404 })]);
    expect(await client.getPod("ns", "p")).toBeNull();
    await client.deletePod("ns", "p");
  });

  it("reports the API reason without echoing the request body", async () => {
    const { client } = api([Response.json({ message: "forbidden by RBAC" }, { status: 403 })]);
    const error = await client
      .createSecret("ns", { stringData: { KEY: "s3cret" } })
      .catch((e) => e);
    expect(error.message).toContain("forbidden by RBAC");
    expect(error.message).not.toContain("s3cret");
  });

  it("sends the Secret owner as a merge patch", async () => {
    const { client, calls } = api([Response.json({})]);
    await client.patchSecretOwner("ns", "s", {
      apiVersion: "v1",
      kind: "Pod",
      name: "p",
      uid: "u",
    });
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.headers["content-type"]).toBe("application/merge-patch+json");
  });
});
