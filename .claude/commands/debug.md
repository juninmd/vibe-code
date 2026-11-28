# /debug — Diagnosticar pipeline de execução de task

Diagnostica problemas no fluxo de uma task do vibe-code (launch → agent → review → PR).

## Argumentos

`/debug <task-id>` ou `/debug` (usa a última task com erro)

## Processo de diagnóstico

### 1. Estado da task no DB
```bash
# Veja o estado atual no banco
bun --eval "
const { Database } = require('bun:sqlite');
const db = new Database(require('os').homedir() + '/.vibe-code/vibe-code.db');
const task = db.prepare('SELECT * FROM tasks WHERE id LIKE ? LIMIT 1').get('%<task-id>%');
const runs = db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 3').all(task?.id);
console.log(JSON.stringify({task, runs}, null, 2));
"
```

### 2. Worktree do agente
- Verifique se existe em `~/.vibe-code/workspaces/<task-id>/`
- Liste commits com `git -C <worktree> log --oneline -10`
- Verfique se há mudanças uncommitted: `git -C <worktree> status`

### 3. Logs do processo
- Acesse os logs via `GET /api/runs/<run-id>/logs` ou na UI em TaskDetail
- Procure por: `[ERROR]`, `[WARN]`, `exit code`, `ENOENT`, `permission denied`

### 4. Checklist de problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Task travada em `running` | Processo filho morreu silenciosamente | Reiniciar servidor |
| PR não criado mas commits existem | `gh` CLI não autenticado | `gh auth login` |
| Worktree não criado | Repositório não clonado/corrompido | Re-clone via UI |
| `exit code 127` | CLI da engine não encontrado no PATH | Instalar engine (ver EnginesPanel) |
| Logs param de aparecer | WebSocket desconectado | Recarregar página |

### 5. Ações de recuperação
Após diagnosticar, sugira uma das ações:
- Retry: `POST /api/tasks/<id>/launch`
- Retry PR: `POST /api/tasks/<id>/retry-pr`
- Cancelar: `POST /api/runs/<run-id>/cancel`
- Limpar worktree: `rm -rf ~/.vibe-code/workspaces/<task-id>`
