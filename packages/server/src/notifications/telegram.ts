import type { Db } from "../db";

export interface TelegramNotifier {
  send(message: string): Promise<void>;
  isConfigured(): boolean;
}

export function createTelegramNotifier(db: Db): TelegramNotifier {
  return {
    isConfigured() {
      const enabled = db.settings.get("telegram_enabled");
      if (enabled === "false") return false;
      const token = db.settings.get("telegram_bot_token");
      const chatId = db.settings.get("telegram_chat_id");
      return !!(token && chatId);
    },

    async send(message: string) {
      const token = db.settings.get("telegram_bot_token");
      const chatId = db.settings.get("telegram_chat_id");
      const enabled = db.settings.get("telegram_enabled");

      if (enabled === "false" || !token || !chatId) return;

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
