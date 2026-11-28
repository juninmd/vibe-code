import { type RefObject, useEffect, useRef } from "react";

const APP_NAME = "Harness Remote";
const UNSEEN_PREFIX = /^\(\d+\) /;

/**
 * Names the current view for assistive tech: mirrors the view's h1 into
 * document.title (keeping the unseen-count prefix owned by useAttention) and,
 * when the view changes, moves focus to that h1 so the change is announced.
 */
export function useViewHeading(container: RefObject<HTMLElement | null>, view: string) {
  useEffect(() => {
    const heading = container.current?.querySelector("h1")?.textContent?.trim();
    const prefix = document.title.match(UNSEEN_PREFIX)?.[0] ?? "";
    const next = `${prefix}${heading ? `${heading} · ${APP_NAME}` : APP_NAME}`;
    if (document.title !== next) document.title = next;
  });

  const previous = useRef(view);
  useEffect(() => {
    if (previous.current === view) return;
    previous.current = view;
    const heading = container.current?.querySelector<HTMLElement>("h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [container, view]);
}
