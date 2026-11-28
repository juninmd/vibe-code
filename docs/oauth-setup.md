# OAuth: GitHub e Google no deploy

O servidor lê as credenciais do secret `vibe-code-secret` (namespace `vibe-code`).
Sem elas a tela de login mostra apenas a chave de operador; o código de contas,
allowlist e vinculação já está ativo.

## 1. GitHub OAuth App

1. Abra https://github.com/settings/developers → **New OAuth App**.
2. Preencha:
   - Application name: `vibe-code`
   - Homepage URL: `https://vibe.antonio-code.duckdns.org`
   - Authorization callback URL: `https://vibe.antonio-code.duckdns.org/api/auth/github/callback`
3. **Register application**, copie o **Client ID** e gere um **Client secret**.

O login lê `/user/emails` e só aceita o e-mail **primário e verificado**.
O scope padrão já inclui `user:email`.

## 2. Google OAuth Client

1. Abra https://console.cloud.google.com/apis/credentials (projeto à sua escolha).
2. Se necessário, configure a **OAuth consent screen** (External, nome do app,
   e-mail de suporte, audience).
3. **Create credentials → OAuth client ID → Web application**.
4. **Authorized redirect URI**: `https://vibe.antonio-code.duckdns.org/api/auth/google/callback`
5. Copie **Client ID** e **Client secret**.

## 3. Aplicar no cluster

```bash
kubectl -n vibe-code patch secret vibe-code-secret --type merge -p '{
  "stringData": {
    "GITHUB_OAUTH_CLIENT_ID": "...",
    "GITHUB_OAUTH_CLIENT_SECRET": "...",
    "GOOGLE_OAUTH_CLIENT_ID": "...",
    "GOOGLE_OAUTH_CLIENT_SECRET": "..."
  }
}'
kubectl -n vibe-code rollout restart deployment/vibe-code
```

O `VIBE_CODE_ALLOWED_EMAILS` já está no secret:

```
jr_acn@hotmail.com,juninho140695@gmail.com
```

Qualquer outro e-mail (ou um e-mail não verificado no GitHub/Google) recebe
`/?auth_error=not_allowed`. A lista é normalizada com trim + lowercase; uma lista
vazia bloqueia todo login OAuth.

## 4. Conferir

```bash
curl -s https://vibe.antonio-code.duckdns.org/api/auth/me | jq '.data.methods'
# { "github": true, "google": true, "apiKey": true }
```

Depois disso, entrar com GitHub cria a conta interna, e "vincular" o Google
(`/api/auth/link/google/start`, a partir da sessão) junta as duas identidades na
mesma conta. E-mails iguais não vinculam sozinhos.
