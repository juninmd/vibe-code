import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: { settings: { runner: { get: vi.fn(), update: vi.fn() } } },
}));
vi.mock("../../api/client", () => ({ api }));

import { RunnerSettings } from "./RunnerSettings";

const settings = {
  runner: "local",
  image: "ghcr.io/juninmd/vibe-code:latest",
  pvc: "harness-remote-data",
  skillsPvc: "",
  imagePullSecret: "",
  idleMinutes: 15,
  maxLifetimeHours: 6,
  startTimeoutSeconds: 180,
  cpuRequest: "250m",
  cpuLimit: "2",
  memoryRequest: "512Mi",
  memoryLimit: "4Gi",
  ephemeralStorageLimit: "10Gi",
  maxPodsPerUser: 2,
  forwardGitHubToken: true,
};

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RunnerSettings />
    </QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("RunnerSettings", () => {
  it("only offers the pod mode when the server runs inside a cluster", async () => {
    api.settings.runner.get.mockResolvedValue({ settings, inCluster: false, activePods: 0 });
    renderIt();
    expect(await screen.findByRole("radio", { name: /Um pod por tarefa/ })).toBeDisabled();
    expect(screen.getByText(/só a execução local está disponível/)).toBeInTheDocument();
  });

  it("saves the pod mode with the chosen idle time", async () => {
    const status = { settings, inCluster: true, namespace: "harness-remote", activePods: 0 };
    api.settings.runner.get.mockResolvedValue(status);
    api.settings.runner.update.mockImplementation(async (data) => ({ ...status, settings: data }));
    renderIt();
    await userEvent.click(await screen.findByRole("radio", { name: /Um pod por tarefa/ }));
    const idle = screen.getByLabelText(/Apagar o pod após/);
    await userEvent.clear(idle);
    await userEvent.type(idle, "30");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Agente abre PRs de dentro do pod/ })
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar execução" }));
    expect(api.settings.runner.update).toHaveBeenCalledWith(
      expect.objectContaining({ runner: "k8s", idleMinutes: 30, forwardGitHubToken: false })
    );
    expect(await screen.findByRole("status")).toHaveTextContent("pod próprio");
  });

  it("shows why the server refused the change", async () => {
    api.settings.runner.get.mockResolvedValue({ settings, inCluster: true, activePods: 0 });
    api.settings.runner.update.mockRejectedValue(
      new Error("Não dá para usar Kubernetes: informe o PVC de dados")
    );
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "Salvar execução" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("informe o PVC");
  });
});
