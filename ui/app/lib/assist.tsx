import React, { createContext, useContext, useMemo, useState } from "react";

// Shared "Dynatrace Assist" panel. Any "Explain with AI" button anywhere in the
// app calls `open({ subject, context })`; the single AssistPanel rendered at the
// app root slides in from the right and runs the conversation.
export type AssistRequest = {
  /** Human-readable entity name, e.g. "Kubernetes pod default/web-abc". */
  subject: string;
  /** Prebuilt metric/log/service summary handed to the model as grounding. */
  context: string;
};

type Ctx = {
  request: AssistRequest | null;
  /** Monotonic id so re-opening the same subject restarts the conversation. */
  nonce: number;
  open: (req: AssistRequest) => void;
  close: () => void;
};

const AssistContext = createContext<Ctx | null>(null);

export const AssistProvider = ({ children }: { children: React.ReactNode }) => {
  const [request, setRequest] = useState<AssistRequest | null>(null);
  const [nonce, setNonce] = useState(0);
  const value = useMemo<Ctx>(
    () => ({
      request,
      nonce,
      open: (req) => {
        setRequest(req);
        setNonce((n) => n + 1);
      },
      close: () => setRequest(null),
    }),
    [request, nonce]
  );
  return <AssistContext.Provider value={value}>{children}</AssistContext.Provider>;
};

export function useAssist(): Ctx {
  const ctx = useContext(AssistContext);
  if (!ctx) throw new Error("useAssist must be used within AssistProvider");
  return ctx;
}
