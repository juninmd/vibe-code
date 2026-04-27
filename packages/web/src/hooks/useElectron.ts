import { useMemo } from "react";

/**
 * Type definitions for Electron IPC API
 */
interface ElectronApi {
  fs: {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<void>;
  };
  clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
  process: {
    platform: string;
    arch: string;
    nodeVersion: string;
  };
  on(channel: string, callback: (event: any, data: any) => void): void;
  off(channel: string, callback: (event: any, data: any) => void): void;
}

/**
 * Hook to access Electron API in React components
 * Returns null if not running in Electron context
 */
export function useElectronApi(): ElectronApi | null {
  return useMemo(() => {
    const w = window as any;
    if (typeof window !== "undefined" && w.vibe) {
      return w.vibe as ElectronApi;
    }
    return null;
  }, []);
}

/**
 * Hook to read file from disk (Electron only)
 */
export function useReadFile() {
  const api = useElectronApi();

  return async (filePath: string): Promise<string | null> => {
    if (!api) {
      console.warn("[useReadFile] Not running in Electron");
      return null;
    }
    try {
      return await api.fs.readFile(filePath);
    } catch (error) {
      console.error("[useReadFile] Failed:", error);
      throw error;
    }
  };
}

/**
 * Hook to write file to disk (Electron only)
 */
export function useWriteFile() {
  const api = useElectronApi();

  return async (filePath: string, content: string): Promise<void> => {
    if (!api) {
      console.warn("[useWriteFile] Not running in Electron");
      return;
    }
    try {
      await api.fs.writeFile(filePath, content);
      console.debug("[useWriteFile] File written:", filePath);
    } catch (error) {
      console.error("[useWriteFile] Failed:", error);
      throw error;
    }
  };
}

/**
 * Hook to access clipboard operations (Electron only)
 */
export function useClipboard() {
  const api = useElectronApi();

  return {
    read: async (): Promise<string | null> => {
      if (!api) {
        console.warn("[useClipboard] Not running in Electron");
        return null;
      }
      try {
        return await api.clipboard.read();
      } catch (error) {
        console.error("[useClipboard.read] Failed:", error);
        throw error;
      }
    },
    write: async (text: string): Promise<void> => {
      if (!api) {
        console.warn("[useClipboard] Not running in Electron");
        return;
      }
      try {
        await api.clipboard.write(text);
      } catch (error) {
        console.error("[useClipboard.write] Failed:", error);
        throw error;
      }
    },
  };
}

/**
 * Hook to control window (Electron only)
 */
export function useWindowControl() {
  const api = useElectronApi();

  return {
    minimize: async (): Promise<void> => {
      if (!api) return;
      await api.window.minimize();
    },
    maximize: async (): Promise<void> => {
      if (!api) return;
      await api.window.maximize();
    },
    close: async (): Promise<void> => {
      if (!api) return;
      await api.window.close();
    },
  };
}
