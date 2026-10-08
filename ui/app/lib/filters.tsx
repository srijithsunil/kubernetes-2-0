import React, { createContext, useContext, useMemo, useState } from "react";

// Global filter selections, shared across all list pages so a chosen
// cluster/namespace/workload/pod persists as you move between nav tabs.
export type Filters = {
  cluster?: string;
  namespace?: string;
  workload?: string;
  pod?: string;
};

export type FilterKey = keyof Filters;

type Ctx = {
  filters: Filters;
  set: (key: FilterKey, value: string | undefined) => void;
  clear: () => void;
};

const FiltersContext = createContext<Ctx | null>(null);

export const FiltersProvider = ({ children }: { children: React.ReactNode }) => {
  const [filters, setFilters] = useState<Filters>({});
  const value = useMemo<Ctx>(
    () => ({
      filters,
      set: (key, v) =>
        setFilters((prev) => {
          const next = { ...prev };
          if (v == null || v === "") delete next[key];
          else next[key] = v;
          return next;
        }),
      clear: () => setFilters({}),
    }),
    [filters]
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
};

export function useFilters(): Ctx {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider");
  return ctx;
}

/**
 * Pick only the filter keys that apply to a given page into a plain object
 * passed to the DQL builders. Pages opt in to the dimensions they support.
 */
export function pick(filters: Filters, keys: FilterKey[]): Filters {
  const out: Filters = {};
  for (const k of keys) if (filters[k]) out[k] = filters[k];
  return out;
}
