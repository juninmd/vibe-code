import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createTelegramNotifier } from "./telegram";

function makeDb(settings: Record<string, string | undefined> = {}) {
  return {
    settings: {
      get: (key: string) => settings[key],
    },
  } as any;
}

const originalEnv = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED,
};

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "env-bot-token";
  process.env.TELEGRAM_CHAT_ID = "-1001234567890";
  delete process.env.TELEGRAM_ENABLED;
});

afterEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = originalEnv.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = originalEnv.TELEGRAM_CHAT_ID;
  if (originalEnv.TELEGRAM_ENABLED === undefined) {
    delete process.env.TELEGRAM_ENABLED;
  } else {
    process.env.TELEGRAM_ENABLED = originalEnv.TELEGRAM_ENABLED;
  }
});

describe("createTelegramNotifier", () => {
  it("uses env credentials when db settings are empty", () => {
    const notifier = createTelegramNotifier(makeDb());
    expect(notifier.isConfigured()).toBe(true);
  });

  it("sends through Telegram using env credentials", async () => {
    const notifier = createTelegramNotifier(makeDb());
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    } as Response);

    await notifier.send("hello");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.telegram.org/botenv-bot-token/sendMessage"
    );
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toEqual({
      chat_id: "-1001234567890",
      text: "hello",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    fetchSpy.mockRestore();
  });
});
