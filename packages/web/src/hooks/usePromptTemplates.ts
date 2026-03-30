import { useState, useEffect, useCallback } from "react";
import type { PromptTemplate, CreatePromptTemplateRequest } from "@vibe-code/shared";
import { api } from "../api/client";

export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.prompts.list()
      .then(setTemplates)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const addTemplate = useCallback(async (data: CreatePromptTemplateRequest) => {
    const template = await api.prompts.create(data);
    setTemplates((prev) => [...prev, template]);
    return template;
  }, []);

  const removeTemplate = useCallback(async (id: string) => {
    await api.prompts.remove(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTemplate = useCallback(async (id: string, data: Partial<CreatePromptTemplateRequest>) => {
    const updated = await api.prompts.update(id, data);
    setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
    return updated;
  }, []);

  return { templates, loading, addTemplate, removeTemplate, updateTemplate };
}
