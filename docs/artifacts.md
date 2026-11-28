# Artefatos de sessão

Arquivos produzidos por uma sessão (prints, relatórios, logs) ficam numa raiz
dedicada e são servidos apenas para quem tem acesso à tarefa.

## Configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `VIBE_CODE_ARTIFACTS_DIR` | `<data>/artifacts` | raiz dedicada dos arquivos |
| `VIBE_CODE_ARTIFACT_MAX_BYTES` | `26214400` (25 MiB) | limite por arquivo |
| `VIBE_CODE_ARTIFACT_RETENTION_DAYS` | `30` | validade de cada artefato |
| `VIBE_CODE_ARTIFACT_QUOTA_BYTES` | `1073741824` (1 GiB) | cota somada por conta |

A varredura de expirados roda no boot e a cada hora; o arquivo é apagado junto
com a linha.

## API

```bash
# registra um arquivo que a sessão produziu (caminho relativo ao worktree)
POST /api/tasks/:id/artifacts            { "path": "docs/assets/task-1-ui.png", "title": "Print" }
# upload cru (o navegador envia os bytes; nome no header)
POST /api/tasks/:id/artifacts/upload     X-File-Name: print.png   Content-Type: image/png
# lista (inclui downloadUrl e uso da cota)
GET  /api/tasks/:id/artifacts
# serve: inline para PNG/JPEG/GIF/WebP, attachment para o resto
GET  /api/tasks/:id/artifacts/:artifactId/file
```

O caminho do arquivo é resolvido com `realpath` e precisa continuar dentro do
worktree (registro) ou da raiz de artefatos (serving); `..`, symlink e troca de
arquivo entre a checagem e a leitura são recusados. Artefato expirado responde
`410 expired`.

Na interface, a sessão aberta mostra a faixa **Evidências** acima do composer:
miniatura inline para imagens e link de download para os demais tipos. Para
`<img>` funcionar com a chave de operador, o frontend anexa `?api_key=` à URL do
arquivo (o servidor aceita a chave na query, como no WebSocket).
