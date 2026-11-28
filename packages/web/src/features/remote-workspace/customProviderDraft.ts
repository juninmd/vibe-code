/** Form state of a custom provider and its conversion to/from the API shape. */
import type {
  CustomProviderAuth,
  CustomProviderInput,
  CustomProviderView,
} from "@vibe-code/shared";

export type AuthType = CustomProviderAuth["type"];

export interface Draft {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  authType: AuthType;
  headerName: string;
  prefix: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  secret: string;
  headers: string;
  models: string;
}

export const EMPTY: Draft = {
  id: "",
  name: "",
  baseUrl: "",
  enabled: true,
  authType: "bearer",
  headerName: "",
  prefix: "",
  tokenUrl: "",
  clientId: "",
  scope: "",
  secret: "",
  headers: "",
  models: "",
};

export const AUTH_LABELS: Record<AuthType, string> = {
  bearer: "Bearer (Authorization)",
  header: "Header customizado",
  oauth2: "OAuth2 client credentials",
  none: "Sem autenticação",
};
export const SECRET_LABELS: Record<AuthType, string> = {
  bearer: "Chave da API",
  header: "Valor do header",
  oauth2: "Client secret",
  none: "",
};

export function toDraft(provider: CustomProviderView): Draft {
  const auth = provider.auth;
  return {
    ...EMPTY,
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    authType: auth.type,
    headerName: auth.type === "header" ? auth.headerName : "",
    prefix: auth.type === "header" ? (auth.prefix ?? "") : "",
    tokenUrl: auth.type === "oauth2" ? auth.tokenUrl : "",
    clientId: auth.type === "oauth2" ? auth.clientId : "",
    scope: auth.type === "oauth2" ? (auth.scope ?? "") : "",
    headers: Object.entries(provider.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n"),
    models: provider.models.join(", "),
  };
}

export function toInput(draft: Draft): CustomProviderInput {
  const auth: CustomProviderAuth =
    draft.authType === "header"
      ? { type: "header", headerName: draft.headerName.trim(), prefix: draft.prefix || undefined }
      : draft.authType === "oauth2"
        ? {
            type: "oauth2",
            tokenUrl: draft.tokenUrl.trim(),
            clientId: draft.clientId.trim(),
            scope: draft.scope.trim() || undefined,
          }
        : { type: draft.authType };
  const headers = Object.fromEntries(
    draft.headers
      .split("\n")
      .map((line) => line.split(/:(.*)/s).map((part) => part?.trim() ?? ""))
      .filter(([name]) => name)
  );
  return {
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    enabled: draft.enabled,
    auth,
    headers,
    models: draft.models
      .split(/[\s,]+/)
      .map((model) => model.trim())
      .filter(Boolean),
    secret: draft.secret || undefined,
  };
}
