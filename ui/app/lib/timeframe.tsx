import React, { createContext, useContext, useMemo, useState } from "react";

// Global timeframe, shared across all pages (like the filter bar) and consumed
// by the DQL builders in queries/k8s.ts via the module-level getters below.
//
// The getters read a module singleton rather than taking a `tf` parameter so
// the ~50 query builders keep their existing signatures. Correctness relies on
// every data-fetching component consuming `useTimeframe()` (so it re-renders
// when the timeframe changes) — the builders are then called during that
// re-render and pick up the fresh window. `setTf` updates the singleton
// synchronously before triggering the React state update.
export type TF = { from: string; to: string };

export const DEFAULT_TF: TF = { from: "now()-30m", to: "now()" };

let CURRENT: TF = DEFAULT_TF;

/** Current global `from:` expression (for DQL builders). */
export function tfFrom(): string {
  return CURRENT.from;
}

/** Current global `to:` expression (for DQL builders). */
export function tfTo(): string {
  return CURRENT.to;
}

/** `from:… , to:…` clause shared by every timeframe-aware query. */
export function win(): string {
  return `from:${CURRENT.from}, to:${CURRENT.to}`;
}

type Ctx = {
  tf: TF;
  setTf: (tf: TF | null) => void;
};

const TimeframeContext = createContext<Ctx | null>(null);

export const TimeframeProvider = ({ children }: { children: React.ReactNode }) => {
  const [tf, setTfState] = useState<TF>(DEFAULT_TF);
  const value = useMemo<Ctx>(
    () => ({
      tf,
      setTf: (next) => {
        const resolved = next ?? DEFAULT_TF;
        CURRENT = resolved;
        setTfState(resolved);
      },
    }),
    [tf]
  );
  return <TimeframeContext.Provider value={value}>{children}</TimeframeContext.Provider>;
};

export function useTimeframe(): Ctx {
  const ctx = useContext(TimeframeContext);
  if (!ctx) throw new Error("useTimeframe must be used within TimeframeProvider");
  return ctx;
}
