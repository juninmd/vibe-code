import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Session } from "./model";
import { useAttention } from "./useAttention";

const session = (id: string, status: Session["status"]) => ({ id, status, title: id }) as Session;

describe("useAttention", () => {
  it("clears the dot and notice of an archived session, and settles without re-render loops", () => {
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ sessions }) => {
        renders++;
        return useAttention(sessions, null, () => {});
      },
      { initialProps: { sessions: [session("a", "working")] } }
    );
    rerender({ sessions: [session("a", "review")] });
    expect(result.current.unseen.has("a")).toBe(true);
    expect(result.current.notices).toHaveLength(1);

    rerender({ sessions: [] });
    expect(result.current.unseen.size).toBe(0);
    expect(result.current.notices).toHaveLength(0);

    const settled = renders;
    rerender({ sessions: [] });
    expect(renders - settled).toBe(1);
  });
});
