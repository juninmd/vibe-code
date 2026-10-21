import { useState } from "react";
import { normalizeServerUrl, setServerUrl } from "./server-url";

/** First-run screen of the Android app: pick the Harness server to control. */
export default function ServerSetup() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const url = normalizeServerUrl(value);
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(String(res.status));
      setServerUrl(url);
      window.location.reload();
    } catch {
      setError("Não foi possível conectar. Verifique o endereço e a rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <form onSubmit={connect} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Harness Remote</h1>
        <p className="text-sm text-zinc-400">
          Informe o endereço do servidor (ex.: 192.168.0.10:3000).
        </p>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://meu-servidor.com"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 font-medium disabled:opacity-50"
        >
          {busy ? "Conectando…" : "Conectar"}
        </button>
      </form>
    </main>
  );
}
