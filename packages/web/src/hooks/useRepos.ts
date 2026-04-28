import type { CreateRepoRequest, Repository } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
  initialDelay = INITIAL_RETRY_DELAY
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = initialDelay * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

export function useRepos() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(2_000);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await withRetry(() => api.repos.list());
      setRepos(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error("Failed to fetch repos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any repo is cloning
  useEffect(() => {
    const hasCloning = repos.some((r) => r.status === "cloning" || r.status === "pending");
    if (hasCloning && !pollRef.current) {
      const scheduleNext = () => {
        pollRef.current = setTimeout(async () => {
          try {
            await refresh();
          } catch (err) {
            console.error("Polling failed:", err);
          }
          pollRef.current = null;
          pollDelayRef.current = Math.min(pollDelayRef.current * 2, 8_000);
          scheduleNext();
        }, pollDelayRef.current);
      };
      pollDelayRef.current = 2_000;
      scheduleNext();
    } else if (!hasCloning && pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
      pollDelayRef.current = 2_000;
    }
    return () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [repos, refresh]);

  const addRepo = useCallback(
    async (data: CreateRepoRequest) => {
      const repo = await api.repos.create(data);
      await refresh();
      return repo;
    },
    [refresh]
  );

  const removeRepo = useCallback(
    async (id: string) => {
      await api.repos.remove(id);
      await refresh();
    },
    [refresh]
  );

  const deleteLocalClone = useCallback(async (id: string) => {
    const repo = await api.repos.deleteLocalClone(id);
    setRepos((prev) => prev.map((item) => (item.id === repo.id ? repo : item)));
    return repo;
  }, []);

  const purgeLocalClones = useCallback(async () => {
    const result = await api.repos.purgeLocalClones();
    await refresh();
    return result;
  }, [refresh]);

  const addOrUpdateRepo = useCallback((repo: Repository) => {
    setRepos((prev) => {
      const idx = prev.findIndex((r) => r.id === repo.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = repo;
        return next;
      }
      return [repo, ...prev];
    });
  }, []);

  return {
    repos,
    loading,
    error,
    refresh,
    addRepo,
    removeRepo,
    deleteLocalClone,
    purgeLocalClones,
    addOrUpdateRepo,
  };
}
