// Publish button state derived from session state (idea from T3 Code GitActionsControl.logic, MIT).
export interface PublishInput {
  working: boolean;
  publishing: boolean;
  prUrl?: string | null;
  /** Files changed on the session branch; null while unknown. */
  changedFiles: number | null;
}
export interface PublishAction {
  label: "Criar PR" | "Atualizar PR" | "Publicando…";
  disabled: boolean;
  primary: boolean;
  hint: string;
}

export function resolvePublishAction(input: PublishInput): PublishAction {
  const label = input.publishing ? "Publicando…" : input.prUrl ? "Atualizar PR" : "Criar PR";
  const base = { label, primary: !input.prUrl } as const;
  if (input.publishing) return { ...base, disabled: true, hint: "Commit, push e PR em andamento" };
  if (input.working) return { ...base, disabled: true, hint: "Aguarde o turno terminar" };
  if (input.changedFiles === 0)
    return {
      ...base,
      primary: false,
      disabled: true,
      hint: input.prUrl ? "Nada novo desde o último push" : "Sem alterações para publicar",
    };
  const files =
    input.changedFiles === null
      ? ""
      : ` (${input.changedFiles} ${input.changedFiles === 1 ? "arquivo" : "arquivos"})`;
  return {
    ...base,
    disabled: false,
    hint: input.prUrl
      ? `Commit e push das novas alterações no mesmo PR${files}`
      : `Commit, push e abertura do pull request${files}`,
  };
}
