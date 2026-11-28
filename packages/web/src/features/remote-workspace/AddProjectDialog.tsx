import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import { api } from "../../api/client";
import { Icon } from "./Icon";

const normalize = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");

/** Pick a GitHub repository (or paste any Git URL) and follow the clone until it is usable. */
export function AddProjectPanel({
  existingUrls,
  onReady,
  onConnectGitHub,
}: {
  existingUrls: string[];
  onReady: (repoId: string) => void;
  onConnectGitHub: () => void;
}) {
  const [search, setSearch] = useState("");
  const [url, setUrl] = useState("");
  const [repoId, setRepoId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const term = useDeferredValue(search.trim());
  const remotes = useQuery({
    queryKey: ["add-project-remotes", term],
    queryFn: () => (term ? api.repos.searchGitHub(term) : api.repos.listGitHub()),
    retry: false,
    staleTime: 60_000,
  });
  const clone = useQuery({
    queryKey: ["add-project-clone", repoId],
    queryFn: () => api.repos.get(repoId ?? ""),
    enabled: !!repoId,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "ready" || query.state.data?.status === "error" ? false : 2000,
  });
  const status = repoId ? clone.data?.status : undefined;
  useEffect(() => {
    if (repoId && status === "ready") onReady(repoId);
  }, [repoId, status, onReady]);

  const add = async (target: string) => {
    setBusy(true);
    setAddError(null);
    setRepoId(null);
    try {
      const repo = await api.repos.create({ url: target.trim() });
      setRepoId(repo.id);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Não foi possível adicionar o projeto.");
    } finally {
      setBusy(false);
    }
  };
  const cloning = !!repoId && status !== "ready" && status !== "error" && !clone.error;
  const failure =
    addError ??
    (status === "error" ? (clone.data?.errorMessage ?? "Falha ao clonar o repositório.") : null) ??
    (clone.error instanceof Error ? clone.error.message : null);
  const added = new Set(existingUrls.map(normalize));
  const locked = busy || cloning;

  return (
    <div className="rw-add-project">
      {cloning && (
        <p role="status" className="rw-inline-state">
          Clonando o repositório… a sessão abre quando terminar.
        </p>
      )}
      {failure && (
        <p role="alert" className="rw-add-error">
          {failure}
        </p>
      )}
      {remotes.error ? (
        <div className="rw-add-connect">
          <p>Conecte o GitHub para escolher entre os seus repositórios.</p>
          <small>{remotes.error.message}</small>
          <button type="button" className="rw-button" onClick={onConnectGitHub}>
            Conectar GitHub
          </button>
        </div>
      ) : (
        <>
          <label className="rw-search rw-dialog-search">
            <Icon name="search" />
            <input
              data-autofocus
              aria-label="Buscar no GitHub"
              placeholder="Buscar nos seus repositórios do GitHub…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <ul className="rw-add-list" aria-label="Repositórios do GitHub">
            {remotes.data?.map((repo) => (
              <li key={repo.url}>
                <span>
                  <strong>{repo.name}</strong>
                  <small>
                    {repo.isPrivate ? "Privado" : "Público"}
                    {repo.description ? ` · ${repo.description}` : ""}
                  </small>
                </span>
                {added.has(normalize(repo.url)) ? (
                  <small>Já ativo</small>
                ) : (
                  <button
                    type="button"
                    className="rw-button"
                    aria-label={`Ativar ${repo.name}`}
                    disabled={locked}
                    onClick={() => void add(repo.url)}
                  >
                    Ativar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {remotes.isLoading && (
            <p role="status" className="rw-inline-state">
              Carregando repositórios…
            </p>
          )}
          {remotes.data?.length === 0 && (
            <p className="rw-inline-state">Nenhum repositório encontrado.</p>
          )}
        </>
      )}
      <form
        className="rw-add-url"
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) void add(url);
        }}
      >
        <label>
          Outro repositório (GitLab ou qualquer URL Git)
          <input
            aria-label="URL do repositório"
            placeholder="https://…/projeto.git"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button type="submit" className="rw-button primary" disabled={!url.trim() || locked}>
          Adicionar por URL
        </button>
      </form>
    </div>
  );
}
