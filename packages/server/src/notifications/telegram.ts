import type { Db } from "../db";

export interface TelegramNotifier {
  send(message: string): Promise<void>;
  isConfigured(): boolean;
}

export interface TelegramConfig {
  token: string | null;
  chatId: string | null;
  enabled: boolean;
}

type TelegramEnv = NodeJS.ProcessEnv;
type TelegramFetch = typeof fetch;

export function resolveTelegramConfig(db: Db, env: TelegramEnv = process.env): TelegramConfig {
  const token = db.settings.get("telegram_bot_token") || env.TELEGRAM_BOT_TOKEN || null;
  const chatId = db.settings.get("telegram_chat_id") || env.TELEGRAM_CHAT_ID || null;
  const enabledSetting = db.settings.get("telegram_enabled");
  const enabled =
    enabledSetting === undefined ? env.TELEGRAM_ENABLED !== "false" : enabledSetting !== "false";

  return { token, chatId, enabled };
}

export function createTelegramNotifier(
  db: Db,
  env: TelegramEnv = process.env,
  fetchFn: TelegramFetch = fetch
): TelegramNotifier {
  return {
    isConfigured() {
      const { enabled, token, chatId } = resolveTelegramConfig(db, env);
      return enabled && !!(token && chatId);
    },

    async send(message: string) {
      const { token, chatId, enabled } = resolveTelegramConfig(db, env);

      if (!enabled || !token || !chatId) return;

      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API error ${res.status}: ${body}`);
      }
    },
  };
}
