import React, { useEffect, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { openApp } from "@dynatrace-sdk/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { TimeseriesChart } from "@dynatrace/strato-components/charts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Chip } from "@dynatrace/strato-components/content";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { ArrowLeftIcon } from "@dynatrace/strato-icons";
import * as Q from "../queries/k8s";
import {
  records,
  str,
  lastNum,
  sumLast,
  fmtCores,
  fmtBytes,
  fmtDuration,
  fmtThousands,
  phaseLabel,
  deriveWorkload,
  toTimeseries,
  type ChartSeries,
} from "../lib/series";
import { useAssist } from "../lib/assist";
import { useTimeframe } from "../lib/timeframe";
import { SidePanel } from "./SidePanel";
import { SummaryBar, type SummaryStatus } from "./SummaryBar";

// Built-in Dynatrace Problems app.
const PROBLEMS_APP_ID = "dynatrace.davis.problems";

export type Selection =
  | { type: "pod"; namespace: string; pod: string }
  | { type: "node"; node: string }
  | {
      type: "workload";
      kind: "Deployment" | "StatefulSet" | "DaemonSet" | "ReplicaSet";
      namespace: string;
      name: string;
    }
  | { type: "namespace"; namespace: string }
  | { type: "cluster"; uid: string }
  | { type: "service"; service: string };

type Nav = (s: Selection) => void;

// ---- shared building blocks ----------------------------------------------

type SeriesSpec = { field: string; name: string; dimLabel?: string };

/** One metric chart = one DQL query rendered as connected lines. */
const MetricChart = ({
  title,
  query,
  specs,
  height = 200,
}: {
  title: string;
  query: string;
  specs: SeriesSpec[];
  height?: number;
}) => {
  const { data, error, isLoading } = useDql({ query });
  const series: ChartSeries[] = specs.flatMap((s) =>
    toTimeseries(data, s.field, s.name, s.dimLabel)
  );
  return (
    <Flex flexDirection="column" gap={4}>
      <Heading level={4}>{title}</Heading>
      {error ? (
        <Paragraph>Error: {error.message}</Paragraph>
      ) : (
        <TimeseriesChart
          data={series}
          loading={isLoading}
          height={height}
          variant="line"
          gapPolicy="connect"
        />
      )}
    </Flex>
  );
};

type LogRow = { id: string; time: string; level: string; who: string; content: string };

const LogsTable = ({ query, whoField }: { query: string; whoField: string }) => {
  const { data, error, isLoading } = useDql({ query });
  const rows: LogRow[] = records(data).map((r, i) => ({
    id: String(i),
    time: str(r["timestamp"]),
    level: str(r["loglevel"]) || "–",
    who: str(r[whoField]),
    content: str(r["content"]),
  }));
  const columns: DataTableColumnDef<LogRow>[] = [
    { id: "time", header: "Time", accessor: "time" },
    { id: "level", header: "Level", accessor: "level" },
    { id: "who", header: whoField === "k8s.container.name" ? "Container" : "Pod", accessor: "who" },
    { id: "content", header: "Message", accessor: "content" },
  ];
  if (error) return <Paragraph>Error loading logs: {error.message}</Paragraph>;
  if (!isLoading && rows.length === 0)
    return <Paragraph>No logs in the last 30 minutes for this entity.</Paragraph>;
  return <DataTable data={rows} columns={columns} loading={isLoading} />;
};

type SvcRow = { id: string; service: string; requests: number };

const ServicesPanel = ({ query }: { query: string }) => {
  const { data, error, isLoading } = useDql({ query });
  const rows: SvcRow[] = records(data).map((r, i) => ({
    id: String(i),
    service: str(r["service.name"]),
    requests: Math.round(lastNum(r["requests"]) ?? 0),
  }));
  const columns: DataTableColumnDef<SvcRow>[] = [
    { id: "service", header: "Service", accessor: "service" },
    { id: "requests", header: "Requests (2h)", accessor: "requests" },
  ];
  if (error) return <Paragraph>Error loading services: {error.message}</Paragraph>;
  if (!isLoading && rows.length === 0)
    return <Paragraph>No services emitted spans from this entity in the last 2 hours.</Paragraph>;
  return (
    <Flex flexDirection="column" gap={4}>
      <Heading level={3}>Services running here</Heading>
      <DataTable data={rows} columns={columns} loading={isLoading} sortable />
    </Flex>
  );
};

/** A clickable chip that navigates the sheet to a related entity. */
const RelChip = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Chip as="button" onClick={onClick} color="primary">
    {label}
  </Chip>
);

/** Workload chip for a pod — resolves the workload kind, then navigates. */
const WorkloadChip = ({ namespace, workload, nav }: { namespace: string; workload: string; nav: Nav }) => {
  const dep = useDql({ query: Q.workloadKindProbe("Deployment", namespace, workload) });
  const sts = useDql({ query: Q.workloadKindProbe("StatefulSet", namespace, workload) });
  const ds = useDql({ query: Q.workloadKindProbe("DaemonSet", namespace, workload) });
  const kind: "Deployment" | "StatefulSet" | "DaemonSet" = records(dep.data).length
    ? "Deployment"
    : records(sts.data).length
      ? "StatefulSet"
      : records(ds.data).length
        ? "DaemonSet"
        : "Deployment";
  return (
    <RelChip
      label={`Workload: ${workload}`}
      onClick={() => nav({ type: "workload", kind, namespace, name: workload })}
    />
  );
};

/** Opens the shared Dynatrace Assist panel with this entity's context. */
const AiExplain = ({ subject, context }: { subject: string; context: string }) => {
  const { open } = useAssist();
  return (
    <Flex alignItems="center" gap={8}>
      <Button onClick={() => open({ subject, context })} variant="accent">
        Explain with AI · Dynatrace Assist
      </Button>
      <Text textStyle="small">Opens Dynatrace Assist · AI-generated, verify before acting</Text>
    </Flex>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Flex flexDirection="column" gap={12}>
    <Heading level={2}>{title}</Heading>
    {children}
  </Flex>
);

type ConsumerRow = { id: string; name: string; memory: string; _raw: number };

/** Containers (pod) or pods (namespace) ranked by current memory working set. */
const MemoryConsumers = ({
  query,
  labelField,
  valueField,
  header,
  colHeader,
  onPick,
}: {
  query: string;
  labelField: string;
  valueField: string;
  header: string;
  colHeader: string;
  onPick?: (name: string) => void;
}) => {
  const { data, error, isLoading } = useDql({ query });
  const rows: ConsumerRow[] = records(data)
    .map((r, i) => {
      const raw = lastNum(r[valueField]) ?? 0;
      return { id: String(i), name: str(r[labelField]), memory: fmtBytes(raw), _raw: raw };
    })
    .sort((a, b) => b._raw - a._raw);
  const columns: DataTableColumnDef<ConsumerRow>[] = [
    { id: "name", header: colHeader, accessor: "name" },
    { id: "memory", header: "Memory (working set)", accessor: "memory" },
  ];
  if (error) return <Paragraph>Error loading memory consumers: {error.message}</Paragraph>;
  if (!isLoading && rows.length === 0) return <Paragraph>No memory data.</Paragraph>;
  return (
    <Flex flexDirection="column" gap={4}>
      <Heading level={4}>{header}</Heading>
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        sortable
        rowId={(r) => r.name}
        interactiveRows={onPick ? { autoActivate: false } : undefined}
        onActiveRowChange={onPick ? (id) => id != null && onPick(id) : undefined}
      />
    </Flex>
  );
};

type ProblemRow = {
  id: string;
  displayId: string;
  name: string;
  status: string;
  category: string;
  time: string;
};

const problemColumns: DataTableColumnDef<ProblemRow>[] = [
  { id: "displayId", header: "Problem", accessor: "displayId" },
  { id: "name", header: "Event", accessor: "name" },
  { id: "category", header: "Category", accessor: "category" },
  { id: "status", header: "Status", accessor: "status" },
  { id: "time", header: "Opened", accessor: "time" },
];

const toProblemRows = (recs: ReturnType<typeof records>): ProblemRow[] =>
  recs.map((r, i) => ({
    id: String(i),
    displayId: str(r["display_id"]),
    name: str(r["event.name"]),
    status: str(r["event.status"]),
    category: str(r["event.category"]),
    time: str(r["timestamp"]),
  }));

/** Dynatrace Intelligence problems tied to this pod's workload, with a jump to the Problems app. */
const ProblemsPanel = ({ namespace, workload }: { namespace: string; workload: string }) => {
  const byWorkload = useDql({ query: Q.podProblemsByWorkload(namespace, workload) });
  const workloadRows = records(byWorkload.data);
  const needFallback = !byWorkload.isLoading && workloadRows.length === 0;
  const byNamespace = useDql({ query: Q.podProblemsByNamespace(namespace) }, { enabled: needFallback });
  const usingFallback = needFallback;
  const rows = toProblemRows(usingFallback ? records(byNamespace.data) : workloadRows);
  const loading = byWorkload.isLoading || (usingFallback && byNamespace.isLoading);
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex alignItems="center" gap={8} justifyContent="space-between">
        <Heading level={4}>Problems {workload ? `· workload ${workload}` : ""}</Heading>
        <Button onClick={() => openApp(PROBLEMS_APP_ID)} variant="emphasized">
          Open Problems app →
        </Button>
      </Flex>
      {usingFallback ? (
        <Text textStyle="small">
          No problems tied to workload “{workload}”. Showing problems across namespace “{namespace}”.
        </Text>
      ) : null}
      {!loading && rows.length === 0 ? (
        <Paragraph>No Dynatrace Intelligence problems associated with this entity in the last 30 days.</Paragraph>
      ) : (
        <DataTable data={rows} columns={problemColumns} loading={loading} sortable />
      )}
    </Flex>
  );
};

/** Namespace-scoped Dynatrace Intelligence problems. */
const NamespaceProblems = ({ namespace }: { namespace: string }) => {
  const q = useDql({ query: Q.podProblemsByNamespace(namespace) });
  const rows = toProblemRows(records(q.data));
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex alignItems="center" gap={8} justifyContent="space-between">
        <Heading level={4}>Problems · namespace {namespace}</Heading>
        <Button onClick={() => openApp(PROBLEMS_APP_ID)} variant="emphasized">
          Open Problems app →
        </Button>
      </Flex>
      {!q.isLoading && rows.length === 0 ? (
        <Paragraph>No Dynatrace Intelligence problems in namespace “{namespace}” in the last 30 days.</Paragraph>
      ) : (
        <DataTable data={rows} columns={problemColumns} loading={q.isLoading} sortable />
      )}
    </Flex>
  );
};

const EVENTS_NOTE =
  "Restarts are the operator-free signal of instability. Kubernetes object events (Warnings, " +
  "Scheduled, Killing, …) require the OpenTelemetry Collector’s k8sobjectsreceiver, which is not " +
  "emitting on this tenant.";

// ---- entity detail views --------------------------------------------------

const PodDetail = ({ namespace, pod, nav }: { namespace: string; pod: string; nav: Nav }) => {
  const cpu = useDql({ query: Q.podCpu(namespace, pod) });
  const mem = useDql({ query: Q.podMemory(namespace, pod) });
  const svc = useDql({ query: Q.podServices(namespace, pod) });
  const restarts = useDql({ query: Q.podContainerRestarts(namespace, pod) });
  const clusterQ = useDql({ query: Q.podCluster(namespace, pod) });

  const cpuNow = lastNum(records(cpu.data)[0]?.["cpu"]);
  const memNow = lastNum(records(mem.data)[0]?.["working_set"]);
  const clusterUid = str(records(clusterQ.data)[0]?.["k8s.cluster.uid"]);
  const phaseNow = lastNum(records(clusterQ.data)[0]?.["v"]);
  const containers = records(restarts.data);
  const readyCount = containers.length;
  const totalRestarts = containers.reduce((t, r) => t + (lastNum(r["restarts"]) ?? 0), 0);
  const svcNames = records(svc.data).map((r) => str(r["service.name"])).filter(Boolean);
  const workload = deriveWorkload(pod);

  const aiContext = [
    `Pod ${namespace}/${pod} (workload ${workload}).`,
    `Phase: ${phaseLabel(phaseNow)}.`,
    `CPU usage now: ${fmtCores(cpuNow)}.`,
    `Memory working set now: ${fmtBytes(memNow)}.`,
    `Containers: ${readyCount}. Total container restarts: ${Math.round(totalRestarts)}.`,
    svcNames.length ? `Services: ${svcNames.join(", ")}.` : "No services observed via spans.",
  ].join(" ");

  return (
    <Flex flexDirection="column" gap={16}>
      <Flex flexDirection="column" gap={4}>
        <Heading level={3}>Relationships</Heading>
        <Flex gap={8} flexWrap="wrap">
          <RelChip label={`Namespace: ${namespace}`} onClick={() => nav({ type: "namespace", namespace })} />
          <RelChip
            label={clusterUid ? `Cluster: ${clusterUid.slice(0, 8)}` : "Unknown cluster"}
            onClick={() => nav({ type: "cluster", uid: clusterUid })}
          />
          <WorkloadChip namespace={namespace} workload={workload} nav={nav} />
        </Flex>
      </Flex>

      <AiExplain subject={`Kubernetes pod ${namespace}/${pod}`} context={aiContext} />

      <Tabs>
        <Tab title="Overview">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Flex gap={16} flexWrap="wrap">
              <Chip color="primary">Phase: {phaseLabel(phaseNow)}</Chip>
              <Chip color="neutral">Containers: {readyCount}</Chip>
              <Chip color={totalRestarts > 0 ? "critical" : "success"}>Restarts: {Math.round(totalRestarts)}</Chip>
              <Chip color="neutral">CPU: {fmtCores(cpuNow)}</Chip>
              <Chip color="neutral">Memory: {fmtBytes(memNow)}</Chip>
            </Flex>
            <MetricChart title="Pod CPU usage (cores)" query={Q.podCpu(namespace, pod)} specs={[{ field: "cpu", name: "CPU (cores)" }]} />
            <MetricChart title="Pod memory working set (bytes)" query={Q.podMemory(namespace, pod)} specs={[{ field: "working_set", name: "Working set" }]} />
            <ServicesPanel query={Q.podServices(namespace, pod)} />
          </Flex>
        </Tab>

        <Tab title="CPU">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Pod CPU usage (cores)" query={Q.podCpu(namespace, pod)} specs={[{ field: "cpu", name: "CPU (cores)" }]} />
            <MetricChart title="Per-container CPU usage (cores)" query={Q.podContainerCpu(namespace, pod)} specs={[{ field: "cpu", name: "", dimLabel: "k8s.container.name" }]} />
          </Flex>
        </Tab>

        <Tab title="Memory">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="Pod memory (bytes)"
              query={Q.podMemory(namespace, pod)}
              specs={[
                { field: "usage", name: "Usage" },
                { field: "working_set", name: "Working set" },
                { field: "rss", name: "RSS" },
                { field: "available", name: "Available" },
              ]}
            />
            <MetricChart title="Per-container memory working set (bytes)" query={Q.podContainerMemory(namespace, pod)} specs={[{ field: "mem", name: "", dimLabel: "k8s.container.name" }]} />
            <MemoryConsumers
              query={Q.podMemoryConsumers(namespace, pod)}
              labelField="k8s.container.name"
              valueField="memory"
              header="Top memory consumers"
              colHeader="Container"
            />
            <MetricChart
              title="Memory page faults"
              query={Q.podPageFaults(namespace, pod)}
              specs={[
                { field: "page_faults", name: "Page faults" },
                { field: "major_page_faults", name: "Major page faults" },
              ]}
            />
          </Flex>
        </Tab>

        <Tab title="Events">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Container restarts over time" query={Q.podContainerRestarts(namespace, pod)} specs={[{ field: "restarts", name: "", dimLabel: "k8s.container.name" }]} />
            <Text textStyle="small">{EVENTS_NOTE}</Text>
          </Flex>
        </Tab>

        <Tab title="Resource Limits">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="CPU: request vs limit (cores)"
              query={Q.podContainerRequests(namespace, pod)}
              specs={[
                { field: "cpu_request", name: "Request", dimLabel: "k8s.container.name" },
                { field: "cpu_limit", name: "Limit", dimLabel: "k8s.container.name" },
              ]}
            />
            <MetricChart title="CPU usage vs limit (cores)" query={Q.podContainerCpu(namespace, pod)} specs={[{ field: "cpu", name: "Usage", dimLabel: "k8s.container.name" }]} />
            <MetricChart
              title="Memory: request vs limit (bytes)"
              query={Q.podContainerRequests(namespace, pod)}
              specs={[
                { field: "mem_request", name: "Request", dimLabel: "k8s.container.name" },
                { field: "mem_limit", name: "Limit", dimLabel: "k8s.container.name" },
              ]}
            />
            <MetricChart title="Memory usage vs limit (bytes)" query={Q.podContainerMemory(namespace, pod)} specs={[{ field: "mem", name: "Usage", dimLabel: "k8s.container.name" }]} />
          </Flex>
        </Tab>

        <Tab title="Logs">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <LogsTable query={Q.podLogs(namespace, pod)} whoField="k8s.container.name" />
          </Flex>
        </Tab>

        <Tab title="Problems">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <ProblemsPanel namespace={namespace} workload={workload} />
          </Flex>
        </Tab>
      </Tabs>
    </Flex>
  );
};

const NODE_EVENTS_NOTE =
  "Node condition is the operator-free readiness signal (shown above). Kubernetes object events " +
  "(NodeNotReady, MemoryPressure, …) require the OpenTelemetry Collector’s k8sobjectsreceiver, which " +
  "is not emitting on this tenant.";

const NodeDetail = ({ node }: { node: string }) => {
  const cpu = useDql({ query: Q.nodeCpu(node) });
  const mem = useDql({ query: Q.nodeMemory(node) });
  const ready = useDql({ query: Q.nodeReady(node) });
  const cpuNow = lastNum(records(cpu.data)[0]?.["cpu"]);
  const memNow = lastNum(records(mem.data)[0]?.["usage"]);
  const readyNow = lastNum(records(ready.data)[0]?.["ready"]);
  const readyLabel = readyNow == null ? "unknown" : readyNow >= 1 ? "Ready" : "NotReady";
  const aiContext = `Kubernetes node ${node}. Ready: ${readyLabel}. CPU usage now: ${fmtCores(cpuNow)}. Memory usage now: ${fmtBytes(memNow)}. Node allocatable/capacity is not emitted in this OTel feed, so usage values are absolute.`;
  return (
    <Flex flexDirection="column" gap={16}>
      <AiExplain subject={`Kubernetes node ${node}`} context={aiContext} />
      <Tabs>
        <Tab title="Overview">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Flex gap={16} flexWrap="wrap">
              <Chip color={readyNow != null && readyNow >= 1 ? "success" : "critical"}>Ready: {readyLabel}</Chip>
              <Chip color="neutral">CPU: {fmtCores(cpuNow)}</Chip>
              <Chip color="neutral">Memory: {fmtBytes(memNow)}</Chip>
            </Flex>
            <MetricChart title="Node CPU usage (cores)" query={Q.nodeCpu(node)} specs={[{ field: "cpu", name: "CPU (cores)" }]} />
            <MetricChart title="Node memory usage (bytes)" query={Q.nodeMemory(node)} specs={[{ field: "usage", name: "Usage" }]} />
          </Flex>
        </Tab>

        <Tab title="CPU">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Node CPU usage (cores)" query={Q.nodeCpu(node)} specs={[{ field: "cpu", name: "CPU (cores)" }]} />
          </Flex>
        </Tab>

        <Tab title="Memory">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="Node memory (bytes)"
              query={Q.nodeMemory(node)}
              specs={[
                { field: "usage", name: "Usage" },
                { field: "working_set", name: "Working set" },
                { field: "rss", name: "RSS" },
                { field: "available", name: "Available" },
              ]}
            />
            <MetricChart
              title="Memory page faults"
              query={Q.nodePageFaults(node)}
              specs={[
                { field: "page_faults", name: "Page faults" },
                { field: "major_page_faults", name: "Major page faults" },
              ]}
            />
          </Flex>
        </Tab>

        <Tab title="Events">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Node ready condition over time" query={Q.nodeReady(node)} specs={[{ field: "ready", name: "Ready" }]} />
            <Text textStyle="small">{NODE_EVENTS_NOTE}</Text>
          </Flex>
        </Tab>

        <Tab title="Resource Limits">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="Node filesystem: capacity vs usage (bytes)"
              query={Q.nodeFilesystem(node)}
              specs={[
                { field: "capacity", name: "Capacity" },
                { field: "usage", name: "Usage" },
                { field: "available", name: "Available" },
              ]}
            />
            <Text textStyle="small">
              Node CPU/memory allocatable and requests/limits aren’t emitted in this OTel feed — only absolute usage and
              filesystem capacity are available.
            </Text>
          </Flex>
        </Tab>

        <Tab title="Logs">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <LogsTable query={Q.nodeLogs(node)} whoField="k8s.pod.name" />
          </Flex>
        </Tab>

        <Tab title="Problems">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Paragraph>Dynatrace Intelligence problems aren’t scoped to nodes in this feed (problems carry no node dimension). See a pod or workload for associated problems.</Paragraph>
          </Flex>
        </Tab>
      </Tabs>
    </Flex>
  );
};

const WORKLOAD_USAGE_NOTE =
  "Per-workload CPU/memory usage isn’t attributable in this OTel feed — pod→workload linkage isn’t " +
  "emitted. Open an individual pod (via Pods, filtered to this namespace) for container-level usage.";

/** Problem-derived events for a workload (OOM kills, failure-rate, …). */
const WorkloadEvents = ({ namespace, name }: { namespace: string; name: string }) => {
  const q = useDql({ query: Q.podProblemsByWorkload(namespace, name) });
  const rows = toProblemRows(records(q.data));
  return (
    <Flex flexDirection="column" gap={12}>
      <Heading level={4}>Problem-derived events · {name}</Heading>
      {!q.isLoading && rows.length === 0 ? (
        <Paragraph>No Dynatrace Intelligence problems (OOM kills, failure-rate, …) for this workload in the last 30 days.</Paragraph>
      ) : (
        <DataTable data={rows} columns={problemColumns} loading={q.isLoading} sortable />
      )}
      <Text textStyle="small">
        Per-pod restarts aren’t workload-linkable in this feed, and Kubernetes object events need the
        OpenTelemetry Collector’s k8sobjectsreceiver (not emitting here).
      </Text>
    </Flex>
  );
};

const WorkloadDetail = ({
  kind,
  namespace,
  name,
  nav,
}: {
  kind: "Deployment" | "StatefulSet" | "DaemonSet" | "ReplicaSet";
  namespace: string;
  name: string;
  nav: Nav;
}) => {
  const repl = useDql({ query: Q.workloadReplicas(kind, namespace, name) });
  const r0 = records(repl.data)[0];
  const desired = lastNum(r0?.["desired"]);
  const avail = lastNum(r0?.["available"]) ?? lastNum(r0?.["ready"]);
  const availPct =
    desired != null && desired > 0 && avail != null ? Math.round((avail / desired) * 100) : null;

  const specs: SeriesSpec[] =
    kind === "StatefulSet"
      ? [
          { field: "desired", name: "Desired" },
          { field: "ready", name: "Ready" },
          { field: "current", name: "Current" },
          { field: "updated", name: "Updated" },
        ]
      : kind === "DaemonSet"
        ? [
            { field: "desired", name: "Desired" },
            { field: "ready", name: "Ready" },
            { field: "current", name: "Current" },
            { field: "misscheduled", name: "Misscheduled" },
          ]
        : [
            { field: "desired", name: "Desired" },
            { field: "available", name: "Available" },
          ];

  const aiContext = [
    `${kind} ${namespace}/${name}.`,
    `Desired replicas: ${desired ?? "unknown"}.`,
    `Available/ready: ${avail ?? "unknown"}${availPct != null ? ` (${availPct}% availability)` : ""}.`,
    "Per-workload CPU/memory usage is not attributable in this OTel feed (no pod→workload link).",
  ].join(" ");

  return (
    <Flex flexDirection="column" gap={16}>
      <Flex flexDirection="column" gap={4}>
        <Heading level={3}>Relationships</Heading>
        <Flex gap={8} flexWrap="wrap">
          <RelChip label={`Namespace: ${namespace}`} onClick={() => nav({ type: "namespace", namespace })} />
        </Flex>
      </Flex>

      <AiExplain subject={`Kubernetes ${kind} ${namespace}/${name}`} context={aiContext} />

      <Tabs>
        <Tab title="Overview">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Flex gap={16} flexWrap="wrap">
              <Chip color="primary">{kind}</Chip>
              <Chip color="neutral">Desired: {desired ?? "–"}</Chip>
              <Chip color={availPct != null && availPct < 100 ? "warning" : "success"}>
                Available: {avail ?? "–"}
              </Chip>
              <Chip color={availPct != null && availPct < 100 ? "warning" : "success"}>
                Availability: {availPct != null ? `${availPct}%` : "–"}
              </Chip>
            </Flex>
            <MetricChart title={`${kind} replicas`} query={Q.workloadReplicas(kind, namespace, name)} specs={specs} />
            <Text textStyle="small">{WORKLOAD_USAGE_NOTE}</Text>
          </Flex>
        </Tab>

        <Tab title="CPU">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Paragraph>{WORKLOAD_USAGE_NOTE}</Paragraph>
          </Flex>
        </Tab>

        <Tab title="Memory">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Paragraph>{WORKLOAD_USAGE_NOTE}</Paragraph>
          </Flex>
        </Tab>

        <Tab title="Events">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <WorkloadEvents namespace={namespace} name={name} />
          </Flex>
        </Tab>

        <Tab title="Resource Limits">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Paragraph>
              Requests/limits aren’t workload-attributable in this feed (container metrics carry no workload dimension).
              See a pod’s Resource Limits tab, or the Recommendations view for rightsizing findings.
            </Paragraph>
          </Flex>
        </Tab>

        <Tab title="Logs">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <LogsTable query={Q.workloadLogs(namespace, name)} whoField="k8s.pod.name" />
          </Flex>
        </Tab>

        <Tab title="Problems">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <ProblemsPanel namespace={namespace} workload={name} />
          </Flex>
        </Tab>
      </Tabs>
    </Flex>
  );
};

type PodRow = { id: string; pod: string; phase: string; cpu: string; mem: string };

/** Namespace detail — same tabbed layout as a pod, aggregated to the namespace. */
const NamespaceDetail = ({ namespace, nav }: { namespace: string; nav: Nav }) => {
  const clusterQ = useDql({ query: Q.namespaceCluster(namespace) });
  const podsU = useDql({ query: Q.namespacePodsUsage(namespace) });
  const restartsQ = useDql({ query: Q.namespaceRestarts(namespace) });

  const clusterUid = str(records(clusterQ.data)[0]?.["k8s.cluster.uid"]);
  const podRecs = records(podsU.data);
  const podRows: PodRow[] = podRecs
    .map((r) => ({
      id: str(r["k8s.pod.name"]),
      pod: str(r["k8s.pod.name"]),
      phase: phaseLabel(lastNum(r["phase"])),
      cpu: fmtCores(lastNum(r["cpu"])),
      mem: fmtBytes(lastNum(r["mem"])),
    }))
    .filter((r) => r.pod)
    .sort((a, b) => a.pod.localeCompare(b.pod));

  const phaseCounts = podRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.phase] = (acc[r.phase] ?? 0) + 1;
    return acc;
  }, {});

  const openPod = (podName: string) => nav({ type: "pod", namespace, pod: podName });

  const podCols: DataTableColumnDef<PodRow>[] = [
    { id: "pod", header: "Pod", accessor: "pod" },
    { id: "phase", header: "Phase", accessor: "phase" },
    { id: "cpu", header: "CPU", accessor: "cpu" },
    { id: "mem", header: "Memory", accessor: "mem" },
  ];

  const aiContext = `Namespace ${namespace} with ${podRows.length} pods (${Object.entries(phaseCounts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ")}).`;

  const nsRestarts = Math.round(sumLast(records(restartsQ.data), "restarts"));
  const nsCpu = sumLast(podRecs, "cpu");
  const nsFailed = phaseCounts["Failed"] ?? 0;
  const nsStatus: SummaryStatus = nsFailed > 0 ? "critical" : "good";

  return (
    <Flex flexDirection="column" gap={16}>
      <Flex flexDirection="column" gap={4}>
        <Heading level={3}>Relationships</Heading>
        <Flex gap={8} flexWrap="wrap">
          <RelChip
            label={clusterUid ? `Cluster: ${clusterUid.slice(0, 8)}` : "Unknown cluster"}
            onClick={() => nav({ type: "cluster", uid: clusterUid })}
          />
        </Flex>
      </Flex>

      <AiExplain subject={`Kubernetes namespace ${namespace}`} context={aiContext} />

      <SummaryBar
        segments={[
          { label: "Pods", value: podRows.length, status: nsStatus },
          { label: "Running", value: phaseCounts["Running"] ?? 0, status: "good" },
          { label: "Failed", value: nsFailed, status: nsFailed > 0 ? "critical" : "good" },
          { label: "Restarts", value: nsRestarts, status: nsRestarts > 0 ? "warning" : "good" },
          { label: "CPU used", value: fmtCores(nsCpu), status: "good" },
        ]}
      />

      <Tabs>
        <Tab title="Overview">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Flex gap={16} flexWrap="wrap">
              <Chip color="neutral">Pods: {podRows.length}</Chip>
              <Chip color="success">Running: {phaseCounts["Running"] ?? 0}</Chip>
              <Chip color={phaseCounts["Pending"] ? "warning" : "neutral"}>Pending: {phaseCounts["Pending"] ?? 0}</Chip>
              <Chip color={phaseCounts["Failed"] ? "critical" : "neutral"}>Failed: {phaseCounts["Failed"] ?? 0}</Chip>
            </Flex>
            <MetricChart
              title="Aggregate pod CPU / memory"
              query={Q.namespaceUsage(namespace)}
              specs={[
                { field: "cpu", name: "CPU (cores)" },
                { field: "mem", name: "Memory working set (bytes)" },
              ]}
            />
            <ServicesPanel query={Q.namespaceServices(namespace)} />
            <Flex flexDirection="column" gap={4}>
              <Heading level={4}>Pods ({podRows.length})</Heading>
              <DataTable
                data={podRows}
                columns={podCols}
                loading={podsU.isLoading}
                sortable
                rowId={(r) => r.id}
                interactiveRows={{ autoActivate: false }}
                onActiveRowChange={(id) => id != null && openPod(id)}
              />
            </Flex>
          </Flex>
        </Tab>

        <Tab title="CPU">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Aggregate namespace CPU (cores)" query={Q.namespaceUsage(namespace)} specs={[{ field: "cpu", name: "CPU (cores)" }]} />
            <MemoryConsumers
              query={Q.namespacePodsUsage(namespace)}
              labelField="k8s.pod.name"
              valueField="cpu"
              header="Top pods by CPU"
              colHeader="Pod"
              onPick={openPod}
            />
          </Flex>
        </Tab>

        <Tab title="Memory">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Aggregate namespace memory (bytes)" query={Q.namespaceUsage(namespace)} specs={[{ field: "mem", name: "Working set" }]} />
            <MemoryConsumers
              query={Q.namespacePodsUsage(namespace)}
              labelField="k8s.pod.name"
              valueField="mem"
              header="Top memory consumers (pods)"
              colHeader="Pod"
              onPick={openPod}
            />
          </Flex>
        </Tab>

        <Tab title="Events">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart title="Container restarts over time (by pod)" query={Q.namespaceRestarts(namespace)} specs={[{ field: "restarts", name: "", dimLabel: "k8s.pod.name" }]} />
            <Text textStyle="small">{EVENTS_NOTE}</Text>
          </Flex>
        </Tab>

        <Tab title="Resource Limits">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="CPU requests vs limits by container (cores)"
              query={Q.namespaceRequests(namespace)}
              specs={[
                { field: "cpuReq", name: "Request", dimLabel: "k8s.pod.name" },
                { field: "cpuLim", name: "Limit", dimLabel: "k8s.pod.name" },
              ]}
            />
            <MetricChart
              title="Memory requests vs limits by container (bytes)"
              query={Q.namespaceRequests(namespace)}
              specs={[
                { field: "memReq", name: "Request", dimLabel: "k8s.pod.name" },
                { field: "memLim", name: "Limit", dimLabel: "k8s.pod.name" },
              ]}
            />
          </Flex>
        </Tab>

        <Tab title="Logs">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <LogsTable query={Q.namespaceLogs(namespace)} whoField="k8s.pod.name" />
          </Flex>
        </Tab>

        <Tab title="Problems">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <NamespaceProblems namespace={namespace} />
          </Flex>
        </Tab>
      </Tabs>
    </Flex>
  );
};

type RelRow = { id: string; name: string };

const ClusterDetail = ({ nav }: { uid: string; nav: Nav }) => {
  const ns = useDql({ query: Q.clusterNamespaces() });
  const nsRows: RelRow[] = records(ns.data)
    .map((r, i) => ({ id: String(i), name: str(r["k8s.namespace.name"]) }))
    .filter((r) => r.name);
  const columns: DataTableColumnDef<RelRow>[] = [{ id: "name", header: "Namespace", accessor: "name" }];
  return (
    <Flex flexDirection="column" gap={24}>
      <AiExplain
        subject="this Kubernetes cluster"
        context={`Cluster with ${nsRows.length} namespaces: ${nsRows.map((r) => r.name).join(", ")}.`}
      />
      <Section title={`Namespaces (${nsRows.length})`}>
        <DataTable
          data={nsRows}
          columns={columns}
          loading={ns.isLoading}
          rowId={(r) => r.name}
          interactiveRows={{ autoActivate: false }}
          onActiveRowChange={(id) => {
            const row = id != null ? nsRows.find((p) => p.name === id) : undefined;
            if (row) nav({ type: "namespace", namespace: row.name });
          }}
        />
      </Section>
    </Flex>
  );
};

type SvcLocRow = { id: string; namespace: string; pod: string; requests: number };

/** Service detail — RED-ish metrics from spans plus the pods it runs on. */
const ServiceDetail = ({ service, nav }: { service: string; nav: Nav }) => {
  const stat = useDql({ query: Q.serviceStat(service) });
  const failStat = useDql({ query: Q.serviceFailStat(service) });
  const locs = useDql({ query: Q.serviceLocations(service) });

  const s0 = records(stat.data)[0];
  const requests = Math.round(lastNum(s0?.["requests"]) ?? 0);
  const avgDur = lastNum(s0?.["avgDuration"]);
  const failures = Math.round(lastNum(records(failStat.data)[0]?.["failures"]) ?? 0);
  const errRate = requests > 0 ? (failures / requests) * 100 : 0;
  const errStatus: SummaryStatus = errRate > 5 ? "critical" : errRate > 1 ? "warning" : "good";

  const locRows: SvcLocRow[] = records(locs.data)
    .map((r, i) => ({
      id: String(i),
      namespace: str(r["k8s.namespace.name"]),
      pod: str(r["k8s.pod.name"]),
      requests: Math.round(lastNum(r["requests"]) ?? 0),
    }))
    .filter((r) => r.pod);

  const locCols: DataTableColumnDef<SvcLocRow>[] = [
    { id: "namespace", header: "Namespace", accessor: "namespace" },
    { id: "pod", header: "Pod", accessor: "pod" },
    { id: "requests", header: "Requests", accessor: "requests" },
  ];

  const aiContext = [
    `Service ${service}.`,
    `Requests in the selected timeframe: ${requests}.`,
    `Failed requests: ${failures} (${errRate.toFixed(1)}% error rate).`,
    `Average span duration: ${fmtDuration(avgDur)}.`,
    locRows.length
      ? `Runs on pods: ${locRows.slice(0, 10).map((r) => `${r.namespace}/${r.pod}`).join(", ")}.`
      : "No pod location data from spans.",
  ].join(" ");

  return (
    <Flex flexDirection="column" gap={16}>
      <AiExplain subject={`Kubernetes service ${service}`} context={aiContext} />

      <SummaryBar
        segments={[
          { label: "Requests", value: fmtThousands(requests), status: "good" },
          { label: "Failures", value: failures, status: failures > 0 ? errStatus : "good" },
          { label: "Error rate", value: `${errRate.toFixed(1)}%`, status: errStatus },
          { label: "Avg duration", value: fmtDuration(avgDur), status: "good" },
        ]}
      />

      <Tabs>
        <Tab title="Overview">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="Requests over time"
              query={Q.serviceRequestsSeries(service)}
              specs={[{ field: "requests", name: "Requests" }]}
            />
            <MetricChart
              title="Average span duration (ns)"
              query={Q.serviceDurationSeries(service)}
              specs={[{ field: "avgDuration", name: "Avg duration" }]}
            />
          </Flex>
        </Tab>

        <Tab title="Errors">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <MetricChart
              title="Failed requests over time"
              query={Q.serviceFailuresSeries(service)}
              specs={[{ field: "failures", name: "Failures" }]}
            />
            <Text textStyle="small">
              Failures are spans where request.is_failed is true. If this stays flat at zero, the
              span feed on this tenant may not populate that attribute.
            </Text>
          </Flex>
        </Tab>

        <Tab title="Locations">
          <Flex flexDirection="column" gap={16} paddingTop={8}>
            <Heading level={4}>Pods serving this service ({locRows.length})</Heading>
            {!locs.isLoading && locRows.length === 0 ? (
              <Paragraph>No pod/namespace dimensions on this service's spans in the selected timeframe.</Paragraph>
            ) : (
              <DataTable
                data={locRows}
                columns={locCols}
                loading={locs.isLoading}
                sortable
                rowId={(r) => r.id}
                interactiveRows={{ autoActivate: false }}
                onActiveRowChange={(id) => {
                  const row = id != null ? locRows.find((r) => r.id === id) : undefined;
                  if (row) nav({ type: "pod", namespace: row.namespace, pod: row.pod });
                }}
              />
            )}
          </Flex>
        </Tab>
      </Tabs>
    </Flex>
  );
};

const titleFor = (s: Selection): string => {
  switch (s.type) {
    case "pod":
      return `Pod · ${s.namespace}/${s.pod}`;
    case "node":
      return `Node · ${s.node}`;
    case "workload":
      return `${s.kind} · ${s.namespace}/${s.name}`;
    case "namespace":
      return `Namespace · ${s.namespace}`;
    case "cluster":
      return "Cluster";
    case "service":
      return `Service · ${s.service}`;
  }
};

const renderDetail = (s: Selection, nav: Nav) => {
  switch (s.type) {
    case "pod":
      return <PodDetail namespace={s.namespace} pod={s.pod} nav={nav} />;
    case "node":
      return <NodeDetail node={s.node} />;
    case "workload":
      return <WorkloadDetail kind={s.kind} namespace={s.namespace} name={s.name} nav={nav} />;
    case "namespace":
      return <NamespaceDetail namespace={s.namespace} nav={nav} />;
    case "cluster":
      return <ClusterDetail uid={s.uid} nav={nav} />;
    case "service":
      return <ServiceDetail service={s.service} nav={nav} />;
  }
};

/**
 * Drill-down sheet with an in-sheet navigation stack. `selection` is the root
 * entity opened from a page; clicking a relationship pushes onto the stack
 * (Back pops, X closes). Opening a fresh root resets the stack.
 */
export const DetailSheet = ({
  selection,
  onDismiss,
}: {
  selection: Selection | null;
  onDismiss: () => void;
  /** @deprecated nav is handled internally now; kept for call-site compatibility. */
  onNavigate?: (s: Selection) => void;
}) => {
  const [stack, setStack] = useState<Selection[]>([]);
  useTimeframe(); // re-render (and re-run detail queries) when the timeframe changes

  useEffect(() => {
    setStack(selection ? [selection] : []);
  }, [selection]);

  const current = stack[stack.length - 1] ?? selection;
  const canBack = stack.length > 1;
  const nav: Nav = (s) => setStack((st) => [...st, s]);
  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));

  const titleEl = current ? (
    <Flex alignItems="center" gap={8}>
      {canBack ? (
        <Button aria-label="Back" onClick={back}>
          <Button.Prefix>
            <ArrowLeftIcon />
          </Button.Prefix>
          Back
        </Button>
      ) : null}
      <Text>{titleFor(current)}</Text>
    </Flex>
  ) : (
    ""
  );

  return (
    <SidePanel show={selection != null} title={titleEl} onDismiss={onDismiss} width={860}>
      {current ? (
        <Flex flexDirection="column" gap={16}>
          {renderDetail(current, nav)}
        </Flex>
      ) : null}
    </SidePanel>
  );
};
