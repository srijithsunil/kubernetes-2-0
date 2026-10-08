import React, { useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ViewShell } from "../components/ViewShell";
import { DetailSheet, type Selection } from "../components/DetailSheet";
import { detailsColumn } from "../components/detailsColumn";
import { FilterBar } from "../components/FilterBar";
import { SummaryBar, type SummaryStatus } from "../components/SummaryBar";
import * as Q from "../queries/k8s";
import { records, lastNum, str, phaseLabel, fmtCores, fmtBytes } from "../lib/series";
import { useFilters, pick } from "../lib/filters";

type PodRow = {
  id: string;
  namespace: string;
  pod: string;
  phase: string;
  cpu: string;
  mem: string;
  restarts: number;
  ready: string;
};

export const PodsPage = () => {
  const [sel, setSel] = useState<Selection | null>(null);
  const { filters } = useFilters();
  const f = pick(filters, ["cluster", "namespace", "pod"]);
  const phase = useDql({ query: Q.podsPhase(f) });
  const usage = useDql({ query: Q.podsUsage(f) });
  const containers = useDql({ query: Q.podsContainers(f) });

  const loading = phase.isLoading || usage.isLoading || containers.isLoading;
  const error = phase.error || usage.error || containers.error;

  const rows = useMemo<PodRow[]>(() => {
    const key = (ns: string, pod: string) => `${ns}/${pod}`;

    const usageMap = new Map<string, { cpu: number | null; mem: number | null }>();
    for (const r of records(usage.data)) {
      usageMap.set(key(str(r["k8s.namespace.name"]), str(r["k8s.pod.name"])), {
        cpu: lastNum(r["cpu"]),
        mem: lastNum(r["mem"]),
      });
    }

    const contMap = new Map<string, { restarts: number; ready: number; total: number }>();
    for (const r of records(containers.data)) {
      const k = key(str(r["k8s.namespace.name"]), str(r["k8s.pod.name"]));
      const c = contMap.get(k) ?? { restarts: 0, ready: 0, total: 0 };
      c.restarts += Math.round(lastNum(r["restarts"]) ?? 0);
      c.total += 1;
      if ((lastNum(r["ready"]) ?? 0) >= 1) c.ready += 1;
      contMap.set(k, c);
    }

    return records(phase.data)
      .map((r) => {
        const ns = str(r["k8s.namespace.name"]);
        const pod = str(r["k8s.pod.name"]);
        const k = key(ns, pod);
        const u = usageMap.get(k);
        const c = contMap.get(k);
        return {
          id: k,
          namespace: ns,
          pod,
          phase: phaseLabel(lastNum(r["phase"])),
          cpu: fmtCores(u?.cpu ?? null),
          mem: fmtBytes(u?.mem ?? null),
          restarts: c?.restarts ?? 0,
          ready: c ? `${c.ready}/${c.total}` : "–",
        };
      })
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.pod.localeCompare(b.pod));
  }, [phase.data, usage.data, containers.data]);

  const summary = useMemo(() => {
    let running = 0;
    let pending = 0;
    let failed = 0;
    const ns = new Set<string>();
    for (const r of rows) {
      if (r.phase === "Running") running++;
      else if (r.phase === "Pending") pending++;
      else if (r.phase === "Failed") failed++;
      if (r.namespace) ns.add(r.namespace);
    }
    const status: SummaryStatus = failed > 0 ? "critical" : pending > 0 ? "warning" : "good";
    return { total: rows.length, running, pending, failed, namespaces: ns.size, status };
  }, [rows]);

  const columns = useMemo<DataTableColumnDef<PodRow>[]>(
    () => [
      { id: "namespace", header: "Namespace", accessor: "namespace" },
      { id: "pod", header: "Pod", accessor: "pod" },
      { id: "phase", header: "Phase", accessor: "phase" },
      { id: "ready", header: "Ready", accessor: "ready" },
      { id: "restarts", header: "Restarts", accessor: "restarts" },
      { id: "cpu", header: "CPU", accessor: "cpu" },
      { id: "mem", header: "Memory", accessor: "mem" },
      detailsColumn<PodRow>((row) =>
        setSel({ type: "pod", namespace: row.namespace, pod: row.pod })
      ),
    ],
    []
  );

  const openRow = (id: string | null) => {
    const row = id != null ? rows.find((r) => r.id === id) : undefined;
    if (row) setSel({ type: "pod", namespace: row.namespace, pod: row.pod });
  };

  return (
    <ViewShell
      title="Pods"
      caption="Pods grouped by namespace (pod→workload linkage is not emitted in this OTel feed). Click a row for metrics, logs, services and relationships."
    >
      <FilterBar
        keys={["cluster", "namespace", "workload", "pod"]}
        disabled={{
          workload:
            "Pods can't be filtered by workload — this OTel feed doesn't link pods to workloads.",
        }}
      />
      <SummaryBar
        segments={[
          { label: "Pods", value: summary.total, status: summary.status },
          { label: "Running", value: summary.running, status: "good" },
          { label: "Pending", value: summary.pending, status: summary.pending > 0 ? "warning" : "good" },
          { label: "Failed", value: summary.failed, status: summary.failed > 0 ? "critical" : "good" },
          { label: "Namespaces", value: summary.namespaces, status: "good" },
        ]}
      />
      {error ? <p>Error: {error.message}</p> : null}
      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        sortable
        rowId={(r) => r.id}
        interactiveRows={{ autoActivate: false }}
        onActiveRowChange={openRow}
      />
      <DetailSheet selection={sel} onDismiss={() => setSel(null)} />
    </ViewShell>
  );
};
