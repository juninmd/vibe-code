import type { CreateRepoRequest, Repository } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export function useRepos() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(2_000);

  const refresh = useCallback(async () => {
    try {
      const data = await api.repos.list();
      setRepos(data);
    } catch (err) {
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
          await refresh();
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
    refresh,
    addRepo,
    removeRepo,
    deleteLocalClone,
    purgeLocalClones,
    addOrUpdateRepo,
  };
}
