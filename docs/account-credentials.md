# Credenciais por conta

A chave OpenCode Go de cada conta fica cifrada no banco (AES-256-GCM, nonce
único, tag de autenticação, `account + tipo + versão` como dados autenticados).
A API só devolve estado de conexão: o segredo nunca volta para o navegador.

## Configuração do deploy

Gere uma chave de 32 bytes em base64 e coloque no secret:

```bash
KEY=$(openssl rand -base64 32)
kubectl -n vibe-code patch secret vibe-code-secret --type merge \
  -p "{\"stringData\":{\"VIBE_CODE_CREDENTIAL_KEY\":\"$KEY\"}}"
kubectl -n vibe-code rollout restart deployment/vibe-code
```

Variáveis:

- `VIBE_CODE_CREDENTIAL_KEY` — chave atual (base64, 32 bytes).
- `VIBE_CODE_CREDENTIAL_KEY_VERSION` — versão da chave atual (`v1` por padrão).
- `VIBE_CODE_CREDENTIAL_KEYS` — JSON opcional `{"v1":"<base64>","v2":"<base64>"}`
  com versões anteriores para rotação.

Rotação: publique a nova versão em `_KEYS`, aponte `_KEY`/`_KEY_VERSION` para ela,
reinicie (o boot regrava as linhas antigas na versão atual) e só então remova a
chave antiga.

Sem chave configurada, o recurso fica desligado e a API responde
`credentials_not_configured` — nenhuma credencial é gravada em texto puro.

## API (sessão de conta)

```bash
GET    /api/credentials          # estado: connected, version, updatedAt, error
PUT    /api/credentials/opencode # { "apiKey": "..." }
DELETE /api/credentials/opencode
```

A chave de operador (`VIBE_CODE_API_KEY`) não gerencia credenciais de conta.
Na execução, a credencial da conta dona do workspace tem prioridade sobre o
`opencode_go_api_key` global; se a linha não abrir, o run falha com erro
redigido em vez de usar a chave de outra conta.
