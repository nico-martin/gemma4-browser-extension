import { useEffect, useState } from "react";
import { Chat } from "./chat/Chat";
import { BackgroundTasks } from "@/shared/messages";

interface AuthState {
  signedIn: boolean;
  account?: string;
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ signedIn: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ type: BackgroundTasks.AUTH_GET_PROFILE })
      .then((res) => {
        if (res?.ok) setAuth({ signedIn: true, account: res.data?.email ?? res.data?.name });
      })
      .catch(() => undefined);
  }, []);

  const signIn = async () => {
    setError(null);
    const res = await chrome.runtime.sendMessage({ type: BackgroundTasks.AUTH_SIGN_IN });
    if (res?.ok) setAuth({ signedIn: true, account: res.data?.account });
    else setError(res?.error ?? "Sign-in failed");
  };

  if (!auth.signedIn) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">NOG — Recherche juridique</h1>
        <p className="text-sm text-neutral-600 text-center">
          Connectez-vous avec votre compte NOGverse pour démarrer.
        </p>
        <button
          onClick={signIn}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Se connecter
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <span className="text-sm font-semibold">NOG</span>
        <span className="text-xs text-neutral-500">{auth.account}</span>
      </header>
      <Chat />
    </main>
  );
}
