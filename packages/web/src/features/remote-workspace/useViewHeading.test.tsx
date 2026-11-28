import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useViewHeading } from "./useViewHeading";

function View({ view, title }: { view: string; title: string }) {
  const ref = useRef<HTMLElement>(null);
  useViewHeading(ref, view);
  return (
    <main ref={ref}>
      <button type="button">nav</button>
      <h1>{title}</h1>
    </main>
  );
}

afterEach(() => {
  document.title = "";
});

describe("useViewHeading", () => {
  it("names the tab after the view so screen readers and tab lists say where you are", () => {
    const { rerender } = render(<View view="session" title="Nova sessão" />);
    expect(document.title).toBe("Nova sessão · Harness Remote");
    rerender(<View view="session" title="Corrigir login" />);
    expect(document.title).toBe("Corrigir login · Harness Remote");
  });

  it("keeps the unseen-sessions count that useAttention puts in front", () => {
    document.title = "(2) Harness Remote";
    render(<View view="skills" title="Skills" />);
    expect(document.title).toBe("(2) Skills · Harness Remote");
  });

  it("moves focus to the new view's heading only when the view changes", () => {
    const { rerender, getByRole } = render(<View view="session" title="A" />);
    expect(document.activeElement).toBe(document.body);
    rerender(<View view="session" title="B" />);
    expect(document.activeElement).toBe(document.body);
    rerender(<View view="skills" title="Skills" />);
    expect(document.activeElement).toBe(getByRole("heading", { name: "Skills" }));
  });
});
