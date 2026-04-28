import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

export const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  toast: () => {},
  dismiss: () => {},
  dismissAll: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const MAX_TOASTS = 5;
const TOAST_DEDUP_INTERVAL = 3000;

interface _DedupEntry {
  timestamp: number;
}

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const recentMessages = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", action?: ToastAction) => {
      const id = ++counter.current;

      const dedupKey = `${type}:${message}`;
      const now = Date.now();
      const lastShown = recentMessages.current.get(dedupKey);

      if (lastShown && now - lastShown < TOAST_DEDUP_INTERVAL) {
        return;
      }
      recentMessages.current.set(dedupKey, now);

      setToasts((prev) => {
        const next = [...prev];
        if (next.length >= MAX_TOASTS) {
          next.shift();
        }
        return [...next, { id, message, type, action }];
      });

      setTimeout(() => dismiss(id), type === "error" ? 6000 : action ? 5000 : 3500);

      for (const [key, ts] of recentMessages.current.entries()) {
        if (now - ts > TOAST_DEDUP_INTERVAL * 2) {
          recentMessages.current.delete(key);
        }
      }
    },
    [dismiss]
  );

  return { toasts, toast, dismiss, dismissAll };
}
