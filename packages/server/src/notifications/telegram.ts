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

export function resolveTelegramConfig(db: Db): TelegramConfig {
  const token = db.settings.get("telegram_bot_token") || process.env.TELEGRAM_BOT_TOKEN || null;
  const chatId = db.settings.get("telegram_chat_id") || process.env.TELEGRAM_CHAT_ID || null;
  const enabledSetting = db.settings.get("telegram_enabled");
  const enabled =
    enabledSetting === undefined
      ? process.env.TELEGRAM_ENABLED !== "false"
      : enabledSetting !== "false";

  return { token, chatId, enabled };
}

export function createTelegramNotifier(db: Db): TelegramNotifier {
  return {
    isConfigured() {
      const { enabled, token, chatId } = resolveTelegramConfig(db);
      return enabled && !!(token && chatId);
    },

    async send(message: string) {
      const { token, chatId, enabled } = resolveTelegramConfig(db);

      if (!enabled || !token || !chatId) return;

      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
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
