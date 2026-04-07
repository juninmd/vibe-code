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
}

export const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  toast: () => {},
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", action?: ToastAction) => {
      const id = ++counter.current;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      setTimeout(() => dismiss(id), type === "error" ? 6000 : action ? 5000 : 3500);
    },
    [dismiss]
  );

  return { toasts, toast, dismiss };
}
