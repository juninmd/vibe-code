import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "harness-remote-install-dismissed";

export interface InstallPromptState {
  /** The browser fired `beforeinstallprompt` and we can call `promptInstall()`. */
  canInstall: boolean;
  /** The app is already running installed (standalone window). */
  isStandalone: boolean;
  /** iOS/Safari has no install event — show the "Add to Home Screen" hint instead. */
  showIosHint: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  dismiss: () => void;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // iOS Safari uses navigator.standalone instead of the display-mode query.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return mql || iosStandalone;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|chrome|android/i.test(ua);
  return isIos && isSafari;
}

/**
 * Exposes the PWA install affordance: the native prompt where supported and an
 * iOS "Add to Home Screen" hint otherwise.
 */
export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() => detectStandalone());
  const [dismissed, setDismissed] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(DISMISS_KEY) === "1";
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const mql = window.matchMedia?.("(display-mode: standalone)");
    const onChange = () => setIsStandalone(detectStandalone());
    mql?.addEventListener("change", onChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mql?.removeEventListener("change", onChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable — session-only dismissal */
    }
  }, []);

  const showIosHint = !isStandalone && isIosSafari() && !dismissed;

  return {
    canInstall: !!deferred && !dismissed && !isStandalone,
    isStandalone,
    showIosHint,
    promptInstall,
    dismiss,
  };
}
