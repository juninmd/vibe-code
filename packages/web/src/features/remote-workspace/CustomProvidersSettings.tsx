import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Button } from "../../ui/Button";
import {
  AUTH_LABELS,
  type AuthType,
  type Draft,
  EMPTY,
  SECRET_LABELS,
  toDraft,
  toInput,
} from "./customProviderDraft";

/** Settings → Provedores: OpenAI-compatible gateways with their own auth. */
export function CustomProvidersSettings() {
  const query = useQuery({
    queryKey: ["custom-providers"],
    queryFn: api.customProviders.list,
    retry: false,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await work() });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });
  const providers = query.data ?? [];

  return (
    <section className="rw-settings-card" aria-labelledby="custom-providers-title">
      <div className="rw-card-heading">
        <h2 id="custom-providers-title">Provedores customizados</h2>
        <p>
          Gateways compatíveis com OpenAI (LiteLLM, vLLM, Ollama, proxy interno) com a autenticação
          que eles pedem. Os modelos aparecem como <code>id/modelo</code> no seletor do OpenCode.
        </p>
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? "rw-success" : "rw-alert"}
        >
          {message.text}
        </p>
      )}
      {providers.map((provider) => (
        <div key={provider.id} className="rw-plugin-row">
          <span className={`rw-status-dot ${provider.enabled ? "waiting" : "failed"}`} />
          <div>
            <strong>
              {provider.name} <code>{provider.id}/…</code>
            </strong>
            <small>
              {provider.baseUrl} · {AUTH_LABELS[provider.auth.type]}
              {provider.auth.type !== "none" && !provider.secretSet ? " · segredo pendente" : ""}
              {provider.models.length ? ` · ${provider.models.join(", ")}` : ""}
            </small>
          </div>
          <span className="rw-pr-actions">
            <Button
              loading={busy}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await api.customProviders.test(provider.id);
                  if (!result.ok) throw new Error(`${provider.name}: ${result.error}`);
                  return `${provider.name} conectado · ${result.models.length} modelos: ${result.models.slice(0, 6).join(", ")}`;
                })
              }
            >
              Testar
            </Button>
            <Button
              onClick={() => {
                setDraft(toDraft(provider));
                setEditing(true);
              }}
            >
              Editar
            </Button>
            <Button
              loading={busy}
              disabled={busy}
              aria-label={`Remover ${provider.name}`}
              onClick={() =>
                run(async () => {
                  await api.customProviders.remove(provider.id);
                  await query.refetch();
                  return `${provider.name} removido.`;
                })
              }
            >
              Remover
            </Button>
          </span>
        </div>
      ))}
      {!draft ? (
        <span className="rw-pr-actions">
          <Button onClick={() => setDraft({ ...EMPTY })}>Adicionar provedor</Button>
          <Button
            onClick={() =>
              setDraft({
                ...EMPTY,
                id: "litellm-corp",
                name: "LiteLLM corporativo",
                authType: "header",
                headerName: "x-litellm-api-key",
              })
            }
          >
            Modelo LiteLLM com header
          </Button>
        </span>
      ) : (
        <form
          className="rw-settings-form"
          aria-label="Provedor customizado"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api.customProviders.save(draft.id.trim(), toInput(draft));
              setDraft(null);
              setEditing(false);
              await query.refetch();
              return "Provedor salvo. Ele vale a partir do próximo turno.";
            });
          }}
        >
          <label>
            Nome
            <input required value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            Id (prefixo dos modelos)
            <input
              required
              pattern="[a-z][a-z0-9-]{1,31}"
              readOnly={editing}
              value={draft.id}
              onChange={(e) => set({ id: e.target.value.toLowerCase() })}
              placeholder="litellm-corp"
            />
          </label>
          <label>
            URL base (OpenAI-compatible)
            <input
              required
              type="url"
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder="https://litellm.empresa.com/v1"
            />
          </label>
          <label>
            Autenticação
            <select
              value={draft.authType}
              onChange={(e) => set({ authType: e.target.value as AuthType })}
            >
              {(Object.keys(AUTH_LABELS) as AuthType[]).map((type) => (
                <option key={type} value={type}>
                  {AUTH_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          {draft.authType === "header" && (
            <>
              <label>
                Nome do header
                <input
                  required
                  value={draft.headerName}
                  onChange={(e) => set({ headerName: e.target.value })}
                  placeholder="x-litellm-api-key"
                />
              </label>
              <label>
                Prefixo do valor (opcional)
                <input
                  value={draft.prefix}
                  onChange={(e) => set({ prefix: e.target.value })}
                  placeholder="Basic "
                />
              </label>
            </>
          )}
          {draft.authType === "oauth2" && (
            <>
              <label>
                URL do token
                <input
                  required
                  type="url"
                  value={draft.tokenUrl}
                  onChange={(e) => set({ tokenUrl: e.target.value })}
                  placeholder="https://sso.empresa.com/oauth2/token"
                />
              </label>
              <label>
                Client id
                <input
                  required
                  value={draft.clientId}
                  onChange={(e) => set({ clientId: e.target.value })}
                />
              </label>
              <label>
                Escopo (opcional)
                <input value={draft.scope} onChange={(e) => set({ scope: e.target.value })} />
              </label>
            </>
          )}
          {draft.authType !== "none" && (
            <label>
              {SECRET_LABELS[draft.authType]}
              <input
                type="password"
                autoComplete="new-password"
                value={draft.secret}
                onChange={(e) => set({ secret: e.target.value })}
                placeholder={
                  editing ? "Configurado · digite para substituir" : "Fica só no servidor"
                }
              />
            </label>
          )}
          <label>
            Headers extras (um por linha, Nome: valor)
            <textarea
              rows={2}
              spellCheck={false}
              value={draft.headers}
              onChange={(e) => set({ headers: e.target.value })}
              placeholder="x-tenant: acme"
            />
          </label>
          <label>
            Modelos fixos (opcional, além de /models)
            <input value={draft.models} onChange={(e) => set({ models: e.target.value })} />
          </label>
          <label className="rw-setting-toggle">
            <span>Ativo</span>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
          </label>
          <span className="rw-pr-actions">
            <Button type="submit" variant="primary" loading={busy}>
              Salvar provedor
            </Button>
            <Button
              onClick={() => {
                setDraft(null);
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </span>
        </form>
      )}
    </section>
  );
}
