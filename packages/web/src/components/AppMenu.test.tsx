import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppMenu } from "./AppMenu";

function setup(props: Partial<React.ComponentProps<typeof AppMenu>> = {}) {
  const handlers = { onShortcuts: vi.fn(), onChangelog: vi.fn(), onSignOut: vi.fn() };
  render(<AppMenu authEnabled={false} {...handlers} {...props} />);
  return handlers;
}

describe("AppMenu", () => {
  it("does not sign anyone out when the avatar is clicked", async () => {
    const { onSignOut } = setup({ authEnabled: true, user: { username: "ana" } });
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("signs out only through the explicit menu item", async () => {
    const { onSignOut } = setup({ authEnabled: true, user: { username: "ana" } });
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByText("@ana")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("has no account section (and no sign out) when auth is disabled", async () => {
    setup({ authEnabled: false, user: null });
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it("opens shortcuts and the changelog, closing the menu after each", async () => {
    const { onShortcuts, onChangelog } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));
    expect(onShortcuts).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "What's new" }));
    expect(onChangelog).toHaveBeenCalledOnce();
  });

  it("closes on Escape without leaking the key to the page", async () => {
    setup();
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    screen.getByRole("menuitem", { name: "Keyboard shortcuts" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(pageEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", pageEscape);
  });
});
