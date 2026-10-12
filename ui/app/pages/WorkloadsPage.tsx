import React, { useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ViewShell } from "../components/ViewShell";
import { DetailSheet, type Selection } from "../components/DetailSheet";
import { detailsColumn } from "../components/detailsColumn";
import { FilterBar } from "../components/FilterBar";
import { SummaryBar, type SummaryStatus } from "../components/SummaryBar";
import * as Q from "../queries/k8s";
import { records, lastNum, str, fmtCores, fmtBytes, num, type Rec } from "../lib/series";
import { useFilters, pick } from "../lib/filters";
import { useTimeframe } from "../lib/timeframe";

type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

type WorkloadRow = {
  id: string;
  namespace: string;
  name: string;
  kind: string;
  desired: string;
  available: string;
  availability: string;
};

type NsRow = {
  id: string;
  namespace: string;
  restarts: number;
  cpuReq: string;
  cpuLim: string;
  memReq: string;
  memLim: string;
};

const avail = (desired: number | null, available: number | null): string => {
  if (!desired) return "–";
  const a = available ?? 0;
  return `${Math.round((a / desired) * 100)}%`;
};

export const WorkloadsPage = () => {
  const [sel, setSel] = useState<Selection | null>(null);
  const { filters } = useFilters();
  useTimeframe();
  const f = pick(filters, ["cluster", "namespace", "workload"]);
  const deps = useDql({ query: Q.deployments(f) });
  const sts = useDql({ query: Q.statefulsets(f) });
  const ds = useDql({ query: Q.daemonsets(f) });
  const restarts = useDql({ query: Q.restartsByNamespace(f) });
  const reqs = useDql({ query: Q.requestsByNamespace(f) });

  const loading =
    deps.isLoading || sts.isLoading || ds.isLoading || restarts.isLoading || reqs.isLoading;
  const error = deps.error || sts.error || ds.error || restarts.error || reqs.error;

  const workloadRows = useMemo<WorkloadRow[]>(() => {
    const out: WorkloadRow[] = [];
    const push = (
      recs: Rec[],
      nameKey: string,
      kind: string,
      desiredField: string,
      availField: string
    ) => {
      for (const r of recs) {
        const ns = str(r["k8s.namespace.name"]);
        const name = str(r[nameKey]);
        const d = lastNum(r[desiredField]);
        const a = lastNum(r[availField]);
        out.push({
          id: `${kind}/${ns}/${name}`,
          namespace: ns,
          name,
          kind,
          desired: num(d),
          available: num(a),
          availability: avail(d, a),
        });
      }
    };
    push(records(deps.data), "k8s.deployment.name", "Deployment", "desired", "available");
    push(records(sts.data), "k8s.statefulset.name", "StatefulSet", "desired", "ready");
    push(records(ds.data), "k8s.daemonset.name", "DaemonSet", "desired", "ready");
    return out.sort((x, y) => x.namespace.localeCompare(y.namespace) || x.name.localeCompare(y.name));
  }, [deps.data, sts.data, ds.data]);

  const nsRows = useMemo<NsRow[]>(() => {
    const acc = new Map<string, NsRow>();
    const get = (ns: string): NsRow => {
      let row = acc.get(ns);
      if (!row) {
        row = { id: ns, namespace: ns, restarts: 0, cpuReq: "", cpuLim: "", memReq: "", memLim: "" };
        acc.set(ns, row);
      }
      return row;
    };
    const sums = new Map<string, { cpuReq: number; cpuLim: number; memReq: number; memLim: number }>();
    for (const r of records(reqs.data)) {
      const ns = str(r["k8s.namespace.name"]);
      const s = sums.get(ns) ?? { cpuReq: 0, cpuLim: 0, memReq: 0, memLim: 0 };
      s.cpuReq += lastNum(r["cpuReq"]) ?? 0;
      s.cpuLim += lastNum(r["cpuLim"]) ?? 0;
      s.memReq += lastNum(r["memReq"]) ?? 0;
      s.memLim += lastNum(r["memLim"]) ?? 0;
      sums.set(ns, s);
    }
    for (const r of records(restarts.data)) {
      const ns = str(r["k8s.namespace.name"]);
      get(ns).restarts += Math.round(lastNum(r["restarts"]) ?? 0);
    }
    for (const [ns, s] of sums) {
      const row = get(ns);
      row.cpuReq = fmtCores(s.cpuReq);
      row.cpuLim = fmtCores(s.cpuLim);
      row.memReq = fmtBytes(s.memReq);
      row.memLim = fmtBytes(s.memLim);
    }
    return Array.from(acc.values()).sort((a, b) => a.namespace.localeCompare(b.namespace));
  }, [reqs.data, restarts.data]);

  const summary = useMemo(() => {
    const deployments = workloadRows.filter((r) => r.kind === "Deployment").length;
    const statefulsets = workloadRows.filter((r) => r.kind === "StatefulSet").length;
    const daemonsets = workloadRows.filter((r) => r.kind === "DaemonSet").length;
    let degraded = 0;
    for (const r of records(deps.data)) {
      const d = lastNum(r["desired"]);
      const a = lastNum(r["available"]);
      if (d != null && a != null && a < d) degraded++;
    }
    const status: SummaryStatus = degraded > 0 ? "critical" : "good";
    return { total: workloadRows.length, deployments, statefulsets, daemonsets, degraded, status };
  }, [workloadRows, deps.data]);

  const workloadCols = useMemo<DataTableColumnDef<WorkloadRow>[]>(
    () => [
      { id: "namespace", header: "Namespace", accessor: "namespace" },
      { id: "name", header: "Workload", accessor: "name" },
      { id: "kind", header: "Kind", accessor: "kind" },
      { id: "desired", header: "Desired", accessor: "desired" },
      { id: "available", header: "Available", accessor: "available" },
      { id: "availability", header: "Availability", accessor: "availability" },
      detailsColumn<WorkloadRow>((row) =>
        setSel({
          type: "workload",
          kind: row.kind as WorkloadKind,
          namespace: row.namespace,
          name: row.name,
        })
      ),
    ],
    []
  );

  const nsCols = useMemo<DataTableColumnDef<NsRow>[]>(
    () => [
      { id: "namespace", header: "Namespace", accessor: "namespace" },
      { id: "restarts", header: "Restarts", accessor: "restarts" },
      { id: "cpuReq", header: "CPU req", accessor: "cpuReq" },
      { id: "cpuLim", header: "CPU lim", accessor: "cpuLim" },
      { id: "memReq", header: "Mem req", accessor: "memReq" },
      { id: "memLim", header: "Mem lim", accessor: "memLim" },
      detailsColumn<NsRow>((row) => setSel({ type: "namespace", namespace: row.namespace })),
    ],
    []
  );

  const openWorkload = (id: string | null) => {
    const row = id != null ? workloadRows.find((r) => r.id === id) : undefined;
    if (row)
      setSel({
        type: "workload",
        kind: row.kind as WorkloadKind,
        namespace: row.namespace,
        name: row.name,
      });
  };
  const openNs = (id: string | null) => {
    const row = id != null ? nsRows.find((r) => r.id === id) : undefined;
    if (row) setSel({ type: "namespace", namespace: row.namespace });
  };

  return (
    <ViewShell
      title="Workloads"
      caption="Deployments, StatefulSets and DaemonSets from OTel workload metrics. Per-workload usage and pod→workload linkage are not available in this feed; restarts and requests/limits are aggregated per namespace below. Click a row for detail."
    >
      <FilterBar keys={["cluster", "namespace", "workload"]} />
      <SummaryBar
        segments={[
          { label: "Workloads", value: summary.total, status: summary.status },
          { label: "Deployments", value: summary.deployments, status: "good" },
          { label: "StatefulSets", value: summary.statefulsets, status: "good" },
          { label: "DaemonSets", value: summary.daemonsets, status: "good" },
          { label: "Degraded", value: summary.degraded, status: summary.degraded > 0 ? "critical" : "good" },
        ]}
      />
      {error ? <p>Error: {error.message}</p> : null}
      <DataTable
        data={workloadRows}
        columns={workloadCols}
        loading={loading}
        sortable
        rowId={(r) => r.id}
        interactiveRows={{ autoActivate: false }}
        onActiveRowChange={openWorkload}
      />
      <Flex flexDirection="column" gap={8} paddingTop={16}>
        <Heading level={2}>Namespace resources</Heading>
        <DataTable
          data={nsRows}
          columns={nsCols}
          loading={loading}
          sortable
          rowId={(r) => r.id}
          interactiveRows={{ autoActivate: false }}
          onActiveRowChange={openNs}
        />
      </Flex>
      <DetailSheet selection={sel} onDismiss={() => setSel(null)} />
    </ViewShell>
  );
};
