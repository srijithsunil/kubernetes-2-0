// Helpers for turning Grail timeseries records into table rows.

export type Rec = Record<string, unknown>;

export function records(data: unknown): Rec[] {
  const recs = (data as { records?: unknown } | undefined)?.records;
  return Array.isArray(recs) ? (recs as Rec[]) : [];
}

/**
 * Coerce a Grail scalar to a number. Grail serialises large longs (e.g.
 * `count()`) and `duration`/`avg(...)` results as JSON *strings*, so a plain
 * `typeof === "number"` check drops them — accept numeric strings and bigints.
 */
function coerceNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Last non-null numeric value of a timeseries array (or the scalar itself). */
export function lastNum(v: unknown): number | null {
  if (Array.isArray(v)) {
    const arr = v as unknown[];
    for (let i = arr.length - 1; i >= 0; i--) {
      const n = coerceNum(arr[i]);
      if (n != null) return n;
    }
    return null;
  }
  return coerceNum(v);
}

export function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return "";
}

export const POD_PHASE: Record<number, string> = {
  1: "Pending",
  2: "Running",
  3: "Succeeded",
  4: "Failed",
  5: "Unknown",
};

export function phaseLabel(n: number | null): string {
  if (n == null) return "Unknown";
  return POD_PHASE[Math.round(n)] ?? "Unknown";
}

/** CPU cores → compact string (millicores under 1 core). */
export function fmtCores(v: number | null): string {
  if (v == null) return "–";
  if (v < 1) return `${(v * 1000).toFixed(0)} m`;
  return `${v.toFixed(2)} cores`;
}

export function fmtBytes(v: number | null): string {
  if (v == null) return "–";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let n = v;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${u[i]}`;
}

export function num(v: number | null): string {
  return v == null ? "–" : String(Math.round(v));
}

/** Count → thousands with a trailing "K" (e.g. 18,631,754 → "18,632K"). */
export function fmtThousands(v: number | null): string {
  if (v == null) return "–";
  return `${Math.round(v / 1000).toLocaleString("en-US")}K`;
}

/** Span duration (nanoseconds) → compact µs / ms / s string. */
export function fmtDuration(ns: number | null): string {
  if (ns == null) return "–";
  if (ns < 1_000) return `${ns.toFixed(0)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(1)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

export function distinct(recs: Rec[], key: string): Set<string> {
  const s = new Set<string>();
  for (const r of recs) {
    const v = str(r[key]);
    if (v) s.add(v);
  }
  return s;
}

export function sumLast(recs: Rec[], field: string): number {
  let t = 0;
  for (const r of recs) {
    const n = lastNum(r[field]);
    if (n != null) t += n;
  }
  return t;
}

// ---- Timeseries chart helpers --------------------------------------------
// Convert a Grail timeseries result into Strato TimeseriesChart `data`.
// Each record carries a value array plus `interval` (ns) and `timeframe` {start,end}.

export type ChartDatapoint = { start: Date; end: Date; value: number };
export type ChartSeries = { name: string | string[]; datapoints: ChartDatapoint[] };

type Timeframe = { start?: string; end?: string };

/**
 * Convert a Grail timeseries record set into Strato `Timeseries[]`.
 *
 * Each datapoint carries both `start` and `end` (= start + interval) so the
 * chart renders a continuous interval-backed line rather than isolated points.
 * When `dimLabel` is given, the series name is taken from that dimension field
 * on each record (so a grouped query becomes one named line per group);
 * otherwise every record uses `seriesName`.
 */
export function toTimeseries(
  data: unknown,
  valueField: string,
  seriesName: string,
  dimLabel?: string
): ChartSeries[] {
  const recs = records(data);
  const out: ChartSeries[] = [];
  for (const r of recs) {
    const values = r[valueField];
    if (!Array.isArray(values)) continue;
    const interval = Number(r["interval"]) || 60_000_000_000; // ns (default 60s)
    const tf = (r["timeframe"] as Timeframe) ?? {};
    const startMs = tf.start ? new Date(tf.start).getTime() : Date.now();
    const stepMs = interval / 1e6;
    const datapoints: ChartDatapoint[] = [];
    (values as unknown[]).forEach((v, i) => {
      if (typeof v === "number" && !Number.isNaN(v)) {
        const s = startMs + i * stepMs;
        datapoints.push({ start: new Date(s), end: new Date(s + stepMs), value: v });
      }
    });
    if (datapoints.length) {
      const name = dimLabel ? str(r[dimLabel]) || seriesName : seriesName;
      out.push({ name, datapoints });
    }
  }
  return out;
}

/** Merge several single-series results into one multi-series chart dataset. */
export function mergeSeries(...series: ChartSeries[][]): ChartSeries[] {
  return series.flat();
}

/** True when any series has at least one datapoint. */
export function hasData(series: ChartSeries[]): boolean {
  return series.some((s) => s.datapoints.length > 0);
}

/**
 * Derive a workload name from a pod name (the OTel feed doesn't link pods to
 * workloads directly). Strips the generated suffix:
 *   Deployment  `<wl>-<replicaset-hash>-<pod-suffix>`  e.g. load-generator-57b88978b8-zmc44
 *   StatefulSet `<wl>-<ordinal>`                        e.g. astronomy-db-0
 *   DaemonSet   `<wl>-<pod-suffix>`                     e.g. otel-collector-gstnp
 * Returns the pod name unchanged when no pattern matches.
 */
export function deriveWorkload(pod: string): string {
  // Deployment/ReplicaSet: name-<hash 8-10 alnum>-<suffix 5 alnum>
  const dep = /^(.*)-[a-z0-9]{8,10}-[a-z0-9]{5}$/.exec(pod);
  if (dep) return dep[1];
  // StatefulSet ordinal: name-<digits>
  const sts = /^(.*)-\d+$/.exec(pod);
  if (sts) return sts[1];
  // DaemonSet / bare ReplicaSet pod: name-<suffix 5 alnum>
  const ds = /^(.*)-[a-z0-9]{5}$/.exec(pod);
  if (ds) return ds[1];
  return pod;
}
