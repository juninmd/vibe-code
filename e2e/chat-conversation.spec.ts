import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Conversation polish: captures the desktop and phone transcript and exercises
 * the affordances the timeline adds (turns, work log rows, copy, scroll pill,
 * auto-growing composer, pending and stop states).
 *
 * `CHAT_SHOT_PREFIX=before bunx playwright test e2e/chat-conversation.spec.ts`
 * records the baseline screenshots of the previous UI.
 */

const SHOTS = "docs/screenshots/chat-t3code";
const BASELINE = process.env.CHAT_SHOT_PREFIX === "before";
const PREFIX = BASELINE ? "before" : "after";

const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const TITLE = "Polir a conversa do workspace";

const session = {
  id: "chat-polish",
  projectId: "control",
  title: TITLE,
  description: "Deixar a conversa do workspace mais legível e previsível.",
  status: "waiting",
  engine: "opencode",
  model: "Padrão do OpenCode",
  branch: "feat/chat-polish",
  updatedAt: at(2),
  changes: [],
  messages: [
    {
      id: "u1",
      role: "user",
      at: at(22),
      text: "Revise a página de preços e deixe o estado de erro do formulário mais claro. Se der, mostre o diff.",
    },
    {
      id: "a1",
      role: "assistant",
      at: at(21),
      text: "Vou começar pelo formulário de contato.\n\n- O erro some ao digitar, mas o foco fica no campo errado.\n- A mensagem usa `role=\"alert\"` só depois do submit.\n\nDepois comparo com [a referência de acessibilidade](https://www.w3.org/WAI/WCAG22/quickref/).",
    },
    {
      id: "a-work",
      role: "assistant",
      at: at(20),
      text: "",
      work: [
        {
          kind: "read",
          label: "Leu",
          detail: "apps/site/src/pages/pricing/ContactForm.tsx",
          result: "Read 84 non-empty lines",
        },
        {
          kind: "search",
          label: "Buscou",
          detail: '"form-error"',
          result: "Found 6 matches",
        },
        {
          kind: "edit",
          label: "Editou",
          detail: "apps/site/src/pages/pricing/ContactForm.tsx",
          result: "File saved",
        },
        {
          kind: "command",
          label: "Executou",
          detail: "bunx vitest run src/pages/pricing/ContactForm.test.tsx",
          result: "Command completed",
        },
        {
          kind: "command",
          label: "Executou",
          detail: "bun run lint",
          result: "Command exited with code 1",
          failed: true,
        },
      ],
    },
    {
      id: "a2",
      role: "assistant",
      at: at(19),
      text: "Pronto. O formulário agora valida no blur e mantém a mensagem visível até o próximo envio.\n\n```ts\nconst error = useContactError({ onBlur: true, clearOnSubmit: true });\n```\n\nO lint ainda reclama de um import fora de ordem, que eu corrijo no próximo passo.",
    },
    {
      id: "u2",
      role: "user",
      at: at(8),
      text: "Agora rode as verificações do projeto e me diga o que ainda falta.",
    },
    {
      id: "a3",
      role: "assistant",
      at: at(7),
      text: "Rodei typecheck, lint e os testes do pacote.\n\n- **Typecheck**: passou.\n- **Testes**: 42 passaram.\n- **Lint**: um aviso de ordenação de imports em `ContactForm.tsx`.\n\nTambém conferi o comportamento em 390 px: o erro fica abaixo do campo, com uma frase direta, sem deslocar o botão. Falta só ordenar o import e atualizar o changelog.",
    },
    {
      id: "u3",
      role: "user",
      at: at(3),
      text: "E o que ainda falta para publicar?",
    },
    {
      id: "a4",
      role: "assistant",
      at: at(2),
      text: "Só duas coisas: ordenar o import em `ContactForm.tsx` e registrar a mudança no `CHANGELOG.md`. Depois disso o PR pode sair com as capturas de 1440 px e 390 px.",
    },
  ],
};

test("polishes the conversation timeline, composer and scroll affordances", async ({
  page,
  context,
}) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.addInitScript(
    (value) => localStorage.setItem("vibe-unified-prototype-v1", value),
    JSON.stringify([session])
  );
  // Freeze the demo reply timer so the busy state is deterministic.
  await page.clock.install();
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (!error.message.includes("WebSocket closed without opened")) errors.push(error.message);
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/?demo=1&session=chat-polish");
  await expect(page.getByRole("heading", { name: TITLE, exact: true })).toBeVisible();
  const distanceToBottom = () =>
    page
      .locator(".rw-conversation")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

  if (BASELINE) {
    // The previous UI only needs the same three framings for the before/after pair.
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-desktop-conversation.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-mobile-conversation.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator(".rw-conversation").evaluate((element) => element.scrollTo({ top: 0 }));
    await expect(page.getByRole("button", { name: "Ir para o fim" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-desktop-scroll.png`, fullPage: true });
    return;
  }

  await page.screenshot({ path: `${SHOTS}/${PREFIX}-desktop-conversation.png`, fullPage: true });
  await expect.poll(distanceToBottom).toBeLessThan(80);

  // A resize while following the conversation keeps the reader at the end.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(distanceToBottom).toBeLessThan(80);
  await page.screenshot({ path: `${SHOTS}/${PREFIX}-mobile-conversation.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator(".rw-conversation").evaluate((element) => element.scrollTo({ top: 0 }));
  const pill = page.getByRole("button", { name: /Ir para o fim|Novo conteúdo/ });
  await expect(pill).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${PREFIX}-desktop-scroll.png`, fullPage: true });
  await pill.click();
  await expect(pill).toBeHidden();
  await expect.poll(distanceToBottom).toBeLessThan(80);

  const transcript = page.getByRole("region", { name: "Conversa" });
  // Each prompt starts one turn; consecutive assistant segments read as one answer.
  await expect(transcript.getByRole("article", { name: "Mensagem do usuário" })).toHaveCount(3);
  await expect(transcript.getByRole("article", { name: "Resposta do agente" })).toHaveCount(3);

  // Copy a message from the turn body.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const firstUser = transcript.getByRole("article", { name: "Mensagem do usuário" }).first();
  await firstUser.hover();
  await firstUser.getByRole("button", { name: "Copiar mensagem" }).click();
  await expect(firstUser.getByRole("button", { name: "Copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("página de preços");

  // Tool calls are grouped under one header, with per-row outcomes.
  await page.getByText("Falhou em parte").click();
  await expect(transcript.getByText("bun run lint").first()).toBeVisible();
  await expect(transcript.getByText("falhou", { exact: true })).toBeVisible();
  await transcript.getByText("bun run lint").first().click();
  await expect(transcript.getByRole("button", { name: "Copiar comando" })).toBeVisible();

  // The composer grows with the draft, clears on send and shows the stop state.
  await page.setViewportSize({ width: 1440, height: 960 });
  const composer = page.getByRole("textbox", { name: "Mensagem para o agente" });
  const resting = (await composer.boundingBox())?.height ?? 0;
  await composer.fill("linha 1\nlinha 2\nlinha 3\nlinha 4");
  const grown = (await composer.boundingBox())?.height ?? 0;
  expect(grown).toBeGreaterThan(resting);
  await composer.fill("Revise os testes");
  await composer.press("Enter");
  const composerBar = page.locator(".rw-composer");
  await expect(composerBar.getByRole("button", { name: "Parar demonstração" })).toBeVisible();
  await expect(page.getByText("O agente está trabalhando")).toBeVisible();
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveValue("");
  await page.screenshot({ path: `${SHOTS}/${PREFIX}-desktop-busy.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  // The frozen clock also freezes ResizeObserver's frame; advance one frame so the
  // transcript re-anchors before the screenshot.
  await page.clock.runFor(120);
  await expect.poll(distanceToBottom).toBeLessThan(80);
  await page.screenshot({ path: `${SHOTS}/${PREFIX}-mobile-busy.png`, fullPage: true });
  await page.clock.fastForward(1_000);
  await expect(composerBar.getByRole("button", { name: "Enviar mensagem" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Resposta do agente" }).last()).toContainText(
    "critérios de aceite"
  );

  expect(errors).toEqual([]);
});
