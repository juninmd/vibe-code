/** Backlog connectors: pull issues from external trackers and comment back. Normalised shape. */
export type TrackerKind = "jira" | "linear" | "notion" | "clickup" | "asana" | "trello" | "monday";

export interface BacklogItem {
  externalId: string;
  title: string;
  description: string;
  url: string;
  source: TrackerKind;
}

export interface TrackerConfig {
  kind: TrackerKind;
  token: string;
  /** jira: domain · notion: databaseId · clickup: listId · asana: projectId · trello: listId · monday: boardId */
  scope?: string;
  /** jira: email · trello: api key */
  extra?: string;
}

type F = typeof fetch;

async function json(res: Response, name: string): Promise<any> {
  if (!res.ok) throw new Error(`${name} API error: ${res.status} ${res.statusText}`);
  return res.json();
}

const notionTitle = (p: any): string =>
  Object.values(p.properties ?? {})
    .map((v: any) =>
      v?.type === "title" ? (v.title ?? []).map((t: any) => t.plain_text).join("") : ""
    )
    .find(Boolean) || "Untitled";

export async function fetchBacklog(cfg: TrackerConfig, f: F = fetch): Promise<BacklogItem[]> {
  const { kind, token, scope = "", extra = "" } = cfg;
  switch (kind) {
    case "linear": {
      const d = await json(
        await f("https://api.linear.app/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({
            query: `{issues(filter:{state:{type:{eq:"unstarted"}}}){nodes{id title description url}}}`,
          }),
        }),
        "Linear"
      );
      return (d?.data?.issues?.nodes ?? []).map((n: any) => ({
        externalId: n.id,
        title: n.title,
        description: n.description ?? "",
        url: n.url,
        source: kind,
      }));
    }
    case "jira": {
      const auth = Buffer.from(`${extra}:${token}`).toString("base64");
      const jql = encodeURIComponent('statusCategory = "To Do" ORDER BY priority DESC');
      const d = await json(
        await f(
          `https://${scope}.atlassian.net/rest/api/3/search/jql?jql=${jql}&fields=summary,description`,
          {
            headers: { Accept: "application/json", Authorization: `Basic ${auth}` },
          }
        ),
        "Jira"
      );
      return (d.issues ?? []).map((i: any) => ({
        externalId: i.key,
        title: i.fields?.summary ?? i.key,
        description: typeof i.fields?.description === "string" ? i.fields.description : "",
        url: `https://${scope}.atlassian.net/browse/${i.key}`,
        source: kind,
      }));
    }
    case "notion": {
      const d = await json(
        await f(`https://api.notion.com/v1/databases/${scope}/query`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
        "Notion"
      );
      return (d.results ?? []).map((p: any) => ({
        externalId: p.id,
        title: notionTitle(p),
        description: "",
        url: p.url ?? "",
        source: kind,
      }));
    }
    case "clickup": {
      const d = await json(
        await f(`https://api.clickup.com/api/v2/list/${scope}/task`, {
          headers: { Authorization: token },
        }),
        "ClickUp"
      );
      return (d.tasks ?? []).map((t: any) => ({
        externalId: t.id,
        title: t.name,
        description: t.description ?? "",
        url: t.url ?? "",
        source: kind,
      }));
    }
    case "asana": {
      const d = await json(
        await f(
          `https://app.asana.com/api/1.0/projects/${scope}/tasks?opt_fields=name,notes,permalink_url,completed`,
          {
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          }
        ),
        "Asana"
      );
      return (Array.isArray(d.data) ? d.data : [])
        .filter((t: any) => !t.completed)
        .map((t: any) => ({
          externalId: t.gid,
          title: t.name,
          description: t.notes ?? "",
          url: t.permalink_url ?? "",
          source: kind,
        }));
    }
    case "trello": {
      const cards = await json(
        await f(
          `https://api.trello.com/1/lists/${scope}/cards?key=${encodeURIComponent(extra)}&token=${encodeURIComponent(token)}`
        ),
        "Trello"
      );
      return (Array.isArray(cards) ? cards : []).map((c: any) => ({
        externalId: c.id,
        title: c.name,
        description: c.desc ?? "",
        url: c.shortUrl ?? c.url ?? "",
        source: kind,
      }));
    }
    case "monday": {
      const d = await json(
        await f("https://api.monday.com/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({
            query: `query($ids:[ID!]){boards(ids:$ids){items_page{items{id name}}}}`,
            variables: { ids: [scope] },
          }),
        }),
        "Monday"
      );
      if (d.errors) throw new Error(`Monday GraphQL error: ${d.errors[0]?.message}`);
      return (d?.data?.boards?.[0]?.items_page?.items ?? []).map((i: any) => ({
        externalId: String(i.id),
        title: i.name,
        description: "",
        url: "",
        source: kind,
      }));
    }
  }
}

export async function addBacklogComment(
  cfg: TrackerConfig,
  externalId: string,
  text: string,
  f: F = fetch
): Promise<boolean> {
  if (!cfg.token || !externalId || !text) return false;
  const { kind, token, scope = "", extra = "" } = cfg;
  const post = (url: string, headers: Record<string, string>, body?: unknown) =>
    f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    let res: Response;
    switch (kind) {
      case "linear":
        res = await post(
          "https://api.linear.app/graphql",
          { Authorization: token },
          {
            query: `mutation($i:String!,$b:String!){commentCreate(input:{issueId:$i,body:$b}){success}}`,
            variables: { i: externalId, b: text },
          }
        );
        return res.ok && (await res.json())?.data?.commentCreate?.success === true;
      case "jira":
        res = await post(
          `https://${scope}.atlassian.net/rest/api/3/issue/${externalId}/comment`,
          { Authorization: `Basic ${Buffer.from(`${extra}:${token}`).toString("base64")}` },
          {
            body: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            },
          }
        );
        return res.ok;
      case "notion":
        res = await post(
          "https://api.notion.com/v1/comments",
          { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
          { parent: { page_id: externalId }, rich_text: [{ text: { content: text } }] }
        );
        return res.ok;
      case "clickup":
        res = await post(
          `https://api.clickup.com/api/v2/task/${externalId}/comment`,
          { Authorization: token },
          { comment_text: text }
        );
        return res.ok;
      case "asana":
        res = await post(
          `https://app.asana.com/api/1.0/tasks/${externalId}/stories`,
          { Authorization: `Bearer ${token}` },
          { data: { text } }
        );
        return res.ok;
      case "trello":
        res = await post(
          `https://api.trello.com/1/cards/${externalId}/actions/comments?key=${encodeURIComponent(extra)}&token=${encodeURIComponent(token)}&text=${encodeURIComponent(text)}`,
          {}
        );
        return res.ok;
      case "monday":
        res = await post(
          "https://api.monday.com/v2",
          { Authorization: token },
          {
            query: `mutation($i:ID!,$b:String!){create_update(item_id:$i,body:$b){id}}`,
            variables: { i: externalId, b: text },
          }
        );
        return res.ok && !(await res.json()).errors;
    }
  } catch (err) {
    console.warn(
      `[connectors] comment failed (${cfg.kind}): ${err instanceof Error ? err.message : err}`
    );
    return false;
  }
}

export async function sendSlackNotification(
  webhookUrl: string,
  message: string,
  f: F = fetch
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const res = await f(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
