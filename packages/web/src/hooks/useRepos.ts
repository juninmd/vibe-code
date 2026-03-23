import { useState, useEffect, useCallback, useRef } from "react";
import type { Repository, CreateRepoRequest } from "@vibe-code/shared";
import { api } from "../api/client";

export function useRepos() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      pollRef.current = setInterval(refresh, 2000);
    } else if (!hasCloning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [repos, refresh]);

  const addRepo = useCallback(async (data: CreateRepoRequest) => {
    const repo = await api.repos.create(data);
    await refresh();
    return repo;
  }, [refresh]);

  const removeRepo = useCallback(async (id: string) => {
    await api.repos.remove(id);
    await refresh();
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

  return { repos, loading, refresh, addRepo, removeRepo, addOrUpdateRepo };
}
