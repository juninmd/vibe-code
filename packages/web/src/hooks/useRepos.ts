import { useState, useEffect, useCallback } from "react";
import type { Repository, CreateRepoRequest } from "@vibe-code/shared";
import { api } from "../api/client";

export function useRepos() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);

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

  const addRepo = useCallback(async (data: CreateRepoRequest) => {
    const repo = await api.repos.create(data);
    await refresh();
    return repo;
  }, [refresh]);

  const removeRepo = useCallback(async (id: string) => {
    await api.repos.remove(id);
    await refresh();
  }, [refresh]);

  return { repos, loading, refresh, addRepo, removeRepo };
}
