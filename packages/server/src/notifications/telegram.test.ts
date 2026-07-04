import { describe, expect, it, mock } from "bun:test";
import { createTelegramNotifier } from "./telegram";

function makeDb(settings: Record<string, string | undefined> = {}) {
  return {
    settings: {
      get: (key: string) => settings[key],
    },
  } as any;
}

const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED,
};
const testEnv = {
  ...env,
  TELEGRAM_BOT_TOKEN: "env-bot-token",
  TELEGRAM_CHAT_ID: "-1001234567890",
  TELEGRAM_ENABLED: undefined,
};

describe("createTelegramNotifier", () => {
  it("uses env credentials when db settings are empty", () => {
    const notifier = createTelegramNotifier(makeDb(), testEnv);
    expect(notifier.isConfigured()).toBe(true);
  });

  it("sends through Telegram using env credentials", async () => {
    const fetchMock = mock(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      text: async () => "",
    }));
    const notifier = createTelegramNotifier(
      makeDb(),
      testEnv,
      fetchMock as unknown as typeof fetch
    );

    await notifier.send("hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.telegram.org/botenv-bot-token/sendMessage"
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      chat_id: "-1001234567890",
      text: "hello",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  });
});
