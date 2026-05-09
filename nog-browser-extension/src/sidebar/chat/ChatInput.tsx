import { useState, type FormEvent, type KeyboardEvent } from "react";

interface Props {
  onSend: (content: string, includePageContext: boolean) => void | Promise<void>;
  onStop: () => void;
  streaming: boolean;
}

export function ChatInput({ onSend, onStop, streaming }: Props) {
  const [text, setText] = useState("");
  const [usePage, setUsePage] = useState(true);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setText("");
    await onSend(trimmed, usePage);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(e as unknown as FormEvent);
    }
  };

  return (
    <form onSubmit={submit} className="border-t border-neutral-200 bg-white p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Posez votre question juridique…"
        rows={3}
        className="w-full resize-none rounded-md border border-neutral-200 p-2 text-sm focus:border-neutral-400 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between text-xs text-neutral-600">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={usePage}
            onChange={(e) => setUsePage(e.target.checked)}
          />
          Inclure le contexte de la page active
        </label>
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white"
          >
            Arrêter
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Envoyer
          </button>
        )}
      </div>
    </form>
  );
}
