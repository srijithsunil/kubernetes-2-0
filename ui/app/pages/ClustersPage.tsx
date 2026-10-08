import React, { useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { ViewShell } from "../components/ViewShell";
import { DetailSheet, type Selection } from "../components/DetailSheet";
import { FilterBar } from "../components/FilterBar";
import { SummaryBar } from "../components/SummaryBar";
import * as Q from "../queries/k8s";
import { useFilters, pick } from "../lib/filters";
import {
  records,
  distinct,
  sumLast,
  lastNum,
  phaseLabel,
  str,
  fmtCores,
  fmtBytes,
  type Rec,
} from "../lib/series";

type Status = "good" | "warning" | "critical";

type ClusterRow = {
  id: string;
  cluster: string;
  status: Status;
  nodes: number;
  namespaces: number;
  workloads: number;
  pods: number;
  running: number;
  pending: number;
  failed: number;
  degraded: number; // workloads with available < desired
  openProblems: number;
  totalProblems: number;
  cpu: string;
  mem: string;
  cpuReq: string;
  cpuLim: string;
  memReq: string;
  memLim: string;
};

const shortUid = (uid: string) => (uid ? uid.slice(0, 8) : "unknown");

export const ClustersPage = () => {
  const [sel, setSel] = useState<Selection | null>(null);
  const { filters } = useFilters();
  const f = pick(filters, ["cluster"]);
  const pods = useDql({ query: Q.clusterPods(f) });
  const nodes = useDql({ query: Q.clusterNodes() });
  const deps = useDql({ query: Q.deploymentsHealth(f) });
  const sts = useDql({ query: Q.statefulsetsByCluster(f) });
  const ds = useDql({ query: Q.daemonsetsByCluster(f) });
  const containers = useDql({ query: Q.clusterContainers(f) });
  const usage = useDql({ query: Q.clusterPodUsage(f) });
  const problems = useDql({ query: Q.clusterProblems() });

  const loading =
    pods.isLoading ||
    nodes.isLoading ||
    deps.isLoading ||
    sts.isLoading ||
    ds.isLoading ||
    containers.isLoading ||
    usage.isLoading;
  const error =
    pods.error ||
    nodes.error ||
    deps.error ||
    sts.error ||
    ds.error ||
    containers.error ||
    usage.error;

  const rows = useMemo<ClusterRow[]>(() => {
    const podRecs = records(pods.data);
    const nodeRecs = records(nodes.data);
    const depRecs = records(deps.data);
    const stsRecs = records(sts.data);
    const dsRecs = records(ds.data);
    const contRecs = records(containers.data);
    const usageRecs = records(usage.data);
    const probRecs = records(problems.data);

    const uids = distinct(podRecs, "k8s.cluster.uid");
    if (uids.size === 0) uids.add("");

    const byUid = (recs: Rec[], uid: string) =>
      recs.filter((r) => str(r["k8s.cluster.uid"]) === uid);

    return Array.from(uids).map((uid) => {
      const p = byUid(podRecs, uid);
      let running = 0;
      let pending = 0;
      let failed = 0;
      for (const r of p) {
        const label = phaseLabel(lastNum(r["phase"]));
        if (label === "Running") running++;
        else if (label === "Pending") pending++;
        else if (label === "Failed") failed++;
      }
      // Node and workload (deployment/statefulset/daemonset) metrics do NOT
      // carry k8s.cluster.uid in this feed, so they can't be filtered by uid.
      // This is a single-cluster feed → attribute them globally.
      let degraded = 0;
      for (const r of depRecs) {
        const d = lastNum(r["desired"]);
        const a = lastNum(r["available"]);
        if (d != null && a != null && a < d) degraded++;
      }
      const workloads =
        distinct(depRecs, "k8s.deployment.name").size +
        distinct(stsRecs, "k8s.statefulset.name").size +
        distinct(dsRecs, "k8s.daemonset.name").size;

      const prob = probRecs.find((r) => str(r["uid"]) === uid);
      const openProblems = Math.round(lastNum(prob?.["open"]) ?? 0);
      const totalProblems = Math.round(lastNum(prob?.["total"]) ?? 0);

      const status: Status =
        openProblems > 0 || failed > 0
          ? "critical"
          : degraded > 0 || pending > 0
            ? "warning"
            : "good";

      return {
        id: uid || "unknown",
        cluster: shortUid(uid),
        status,
        nodes: distinct(nodeRecs, "k8s.node.name").size,
        namespaces: distinct(p, "k8s.namespace.name").size,
        workloads,
        pods: p.length,
        running,
        pending,
        failed,
        degraded,
        openProblems,
        totalProblems,
        cpu: fmtCores(sumLast(byUid(usageRecs, uid), "cpu")),
        mem: fmtBytes(sumLast(byUid(usageRecs, uid), "mem")),
        cpuReq: fmtCores(sumLast(byUid(contRecs, uid), "cpuReq")),
        cpuLim: fmtCores(sumLast(byUid(contRecs, uid), "cpuLim")),
        memReq: fmtBytes(sumLast(byUid(contRecs, uid), "memReq")),
        memLim: fmtBytes(sumLast(byUid(contRecs, uid), "memLim")),
      };
    });
  }, [pods.data, nodes.data, deps.data, sts.data, ds.data, containers.data, usage.data, problems.data]);

  const totals = useMemo(() => {
    const worst: Status = rows.some((r) => r.status === "critical")
      ? "critical"
      : rows.some((r) => r.status === "warning")
        ? "warning"
        : "good";
    return {
      clusters: rows.length,
      nodes: rows.reduce((t, r) => t + r.nodes, 0),
      namespaces: rows.reduce((t, r) => t + r.namespaces, 0),
      workloads: rows.reduce((t, r) => t + r.workloads, 0),
      openProblems: rows.reduce((t, r) => t + r.openProblems, 0),
      totalProblems: rows.reduce((t, r) => t + r.totalProblems, 0),
      worst,
    };
  }, [rows]);

  const openRow = (id: string | null) => {
    const row = id != null ? rows.find((r) => r.id === id) : undefined;
    if (row) setSel({ type: "cluster", uid: row.id === "unknown" ? "" : row.id });
  };

  const makeTable = (columns: DataTableColumnDef<ClusterRow>[]) => (
    <DataTable
      data={rows}
      columns={columns}
      loading={loading}
      sortable
      rowId={(r) => r.id}
      interactiveRows={{ autoActivate: false }}
      onActiveRowChange={openRow}
    />
  );

  const healthCols: DataTableColumnDef<ClusterRow>[] = [
    { id: "cluster", header: "Cluster (uid)", accessor: "cluster" },
    {
      id: "status",
      header: "Health",
      accessor: (r) => (r.status === "good" ? "Healthy" : r.status === "warning" ? "Degraded" : "Critical"),
    },
    { id: "running", header: "Pods running", accessor: (r) => `${r.running}/${r.pods}` },
    { id: "degraded", header: "Degraded workloads", accessor: "degraded" },
    { id: "openProblems", header: "Open problems", accessor: "openProblems" },
    { id: "totalProblems", header: "Problems (7d)", accessor: "totalProblems" },
    { id: "nodes", header: "Nodes", accessor: "nodes" },
  ];

  const utilCols: DataTableColumnDef<ClusterRow>[] = [
    { id: "cluster", header: "Cluster (uid)", accessor: "cluster" },
    { id: "cpu", header: "CPU used", accessor: "cpu" },
    { id: "cpuReq", header: "CPU requests", accessor: "cpuReq" },
    { id: "cpuLim", header: "CPU limits", accessor: "cpuLim" },
    { id: "mem", header: "Mem used", accessor: "mem" },
    { id: "memReq", header: "Mem requests", accessor: "memReq" },
    { id: "memLim", header: "Mem limits", accessor: "memLim" },
  ];

  const metaCols: DataTableColumnDef<ClusterRow>[] = [
    { id: "cluster", header: "Cluster (uid)", accessor: "cluster" },
    { id: "nodes", header: "Nodes", accessor: "nodes" },
    { id: "namespaces", header: "Namespaces", accessor: "namespaces" },
    { id: "workloads", header: "Workloads", accessor: "workloads" },
    { id: "pods", header: "Pods", accessor: "pods" },
  ];

  return (
    <ViewShell
      title="Clusters"
      caption="Operator-free, from OTel k8s metrics. Cluster name is not emitted in this feed — identified by k8s.cluster.uid. Click a row to drill into namespaces."
    >
      {error ? <Text>Error: {error.message}</Text> : null}

      <FilterBar keys={["cluster"]} />

      {totals.openProblems > 0 ? (
        <MessageContainer variant="critical">
          <MessageContainer.Title>
            {totals.openProblems} open Dynatrace Intelligence problem{totals.openProblems === 1 ? "" : "s"}
          </MessageContainer.Title>
          <MessageContainer.Description>
            Across {totals.clusters} cluster{totals.clusters === 1 ? "" : "s"}. Open a cluster row → Problems for detail.
          </MessageContainer.Description>
        </MessageContainer>
      ) : totals.totalProblems > 0 ? (
        <MessageContainer variant="neutral">
          <MessageContainer.Title>No open problems</MessageContainer.Title>
          <MessageContainer.Description>
            {totals.totalProblems} Dynatrace Intelligence problem{totals.totalProblems === 1 ? "" : "s"} in the last 7 days — all resolved.
          </MessageContainer.Description>
        </MessageContainer>
      ) : null}

      {/* Summary rollup bar */}
      <SummaryBar
        segments={[
          { label: "Clusters", value: totals.clusters, status: totals.worst },
          { label: "Nodes", value: totals.nodes, status: totals.worst },
          { label: "Namespaces", value: totals.namespaces, status: totals.worst },
          { label: "Workloads", value: totals.workloads, status: totals.worst },
        ]}
      />

      <Tabs>
        <Tab title="Health">{makeTable(healthCols)}</Tab>
        <Tab title="Utilization">{makeTable(utilCols)}</Tab>
        <Tab title="Metadata">
          <Flex flexDirection="column" gap={8} paddingTop={8}>
            {makeTable(metaCols)}
            <Text textStyle="small">
              Cluster version and cloud provider are not emitted in this OTel feed — Metadata is limited to counts.
            </Text>
          </Flex>
        </Tab>
      </Tabs>

      <DetailSheet selection={sel} onDismiss={() => setSel(null)} />
    </ViewShell>
  );
};
