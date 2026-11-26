import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { AddProjectPanel } from "./AddProjectDialog";

const remote = (name: string) => ({
  name,
  url: `https://github.com/acme/${name}.git`,
  description: "",
  isPrivate: false,
  provider: "github" as const,
});

function setup(props: Partial<Parameters<typeof AddProjectPanel>[0]> = {}) {
  const onReady = vi.fn();
  const onConnect = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AddProjectPanel existingUrls={[]} onReady={onReady} onConnectGitHub={onConnect} {...props} />
    </QueryClientProvider>
  );
  return { onReady, onConnect };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AddProjectPanel", () => {
  it("activates a GitHub repository with one click and reports it when the clone is ready", async () => {
    vi.spyOn(api.repos, "listGitHub").mockResolvedValue([remote("site")]);
    const create = vi
      .spyOn(api.repos, "create")
      .mockResolvedValue({ id: "r1", status: "cloning" } as never);
    vi.spyOn(api.repos, "get").mockResolvedValue({ id: "r1", status: "ready" } as never);
    const { onReady } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Ativar site" }));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith("r1"));
    expect(create).toHaveBeenCalledWith({ url: "https://github.com/acme/site.git" });
  });

  it("does not offer to activate a repository that is already a project", async () => {
    vi.spyOn(api.repos, "listGitHub").mockResolvedValue([remote("site")]);
    setup({ existingUrls: ["https://github.com/acme/site"] });
    expect(await screen.findByText("Já ativo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ativar site" })).toBeNull();
  });

  it("asks to connect GitHub when the server has no credential", async () => {
    vi.spyOn(api.repos, "listGitHub").mockRejectedValue(new Error("GitHub is not configured"));
    const { onConnect } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Conectar GitHub" }));
    expect(onConnect).toHaveBeenCalled();
  });

  it("shows why a clone failed", async () => {
    vi.spyOn(api.repos, "listGitHub").mockResolvedValue([]);
    vi.spyOn(api.repos, "create").mockResolvedValue({ id: "r2", status: "cloning" } as never);
    vi.spyOn(api.repos, "get").mockResolvedValue({
      id: "r2",
      status: "error",
      errorMessage: "repository not found",
    } as never);
    const { onReady } = setup();
    fireEvent.change(screen.getByLabelText("URL do repositório"), {
      target: { value: "https://example.com/x.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar por URL" }));
    expect(await screen.findByText("repository not found")).toBeTruthy();
    expect(onReady).not.toHaveBeenCalled();
  });
});
