// All DQL for Kubernetes 2.0. Operator-free: ONLY OTel k8s.* / container.* metrics.
// Never uses dt.kubernetes.* (that is the operator-sourced metric set).
// Verified against tenant dzc57470 (single AKS cluster, k8s.cluster.name blank → use k8s.cluster.uid).
import type { Filters } from "../lib/filters";
import { win } from "../lib/timeframe";

// Metrics, logs, spans and events all honour the global timeframe (see
// lib/timeframe.ts → win()). Davis problem queries keep their own historical
// windows (last 7d / 30d) since they are explicitly long-range context.

// ---- filter helpers -------------------------------------------------------
// List pages pass a Filters subset; we inject `filter:{...}` conditions only
// for dimensions a query actually carries. Conditions go in the timeseries
// pre-aggregation filter block (before by/summarize).
type Dims = { cluster?: boolean; namespace?: boolean; pod?: boolean };

function conds(f: Filters, dims: Dims): string[] {
  const p: string[] = [];
  if (dims.cluster && f.cluster) p.push(`k8s.cluster.uid=="${f.cluster}"`);
  if (dims.namespace && f.namespace) p.push(`k8s.namespace.name=="${f.namespace}"`);
  if (dims.pod && f.pod) p.push(`k8s.pod.name=="${f.pod}"`);
  return p;
}

function filt(parts: string[]): string {
  return parts.length ? `, filter:{${parts.join(" and ")}}` : "";
}

// Trailing `and …` conditions for `fetch`-based queries (logs/spans).
function spanConds(f: Filters): string {
  const p: string[] = [];
  if (f.cluster) p.push(`k8s.cluster.uid=="${f.cluster}"`);
  if (f.namespace) p.push(`k8s.namespace.name=="${f.namespace}"`);
  return p.length ? ` and ${p.join(" and ")}` : "";
}

// ---- Logs (top-level view) ------------------------------------------------
// Global k8s pod logs, filtered by cluster / namespace / pod from the filter bar,
// plus a status (loglevel) dropdown and free-text content search.
export const logsList = (
  f: Filters = {},
  opts: { status?: string; search?: string } = {}
) => {
  const parts: string[] = ["isNotNull(k8s.pod.name)"];
  if (f.cluster) parts.push(`k8s.cluster.uid=="${f.cluster}"`);
  if (f.namespace) parts.push(`k8s.namespace.name=="${f.namespace}"`);
  if (f.pod) parts.push(`k8s.pod.name=="${f.pod}"`);
  if (opts.status) parts.push(`loglevel=="${opts.status}"`);
  if (opts.search && opts.search.trim()) {
    const s = opts.search.trim().toLowerCase().replace(/"/g, '\\"');
    parts.push(`contains(lower(content), "${s}")`);
  }
  return `fetch logs, ${win()} | filter ${parts.join(" and ")} | fields timestamp, loglevel, k8s.namespace.name, k8s.pod.name, k8s.container.name, content | sort timestamp desc | limit 500`;
};

// Distinct log levels (status dropdown options).
export const logLevels = () =>
  `fetch logs, ${win()} | filter isNotNull(k8s.pod.name) and isNotNull(loglevel) | dedup loglevel | fields loglevel | sort loglevel asc | limit 20`;

// ---- Clusters -------------------------------------------------------------
// Pods with phase + namespace (drives pod counts, namespace count, phase rollup).
export const clusterPods = (f: Filters = {}) =>
  `timeseries phase = avg(k8s.pod.phase), by:{k8s.cluster.uid, k8s.namespace.name, k8s.pod.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

// Nodes with cpu + memory usage.
export const clusterNodes = () =>
  `timeseries cpu = avg(k8s.node.cpu.usage), mem = avg(k8s.node.memory.working_set), by:{k8s.cluster.uid, k8s.node.name}, ${win()}`;

// Deployments (for workload count).
export const clusterDeployments = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.deployment.desired), by:{k8s.cluster.uid, k8s.namespace.name, k8s.deployment.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

// Per-container requests/limits + usage (summed for cluster totals).
export const clusterContainers = (f: Filters = {}) =>
  `timeseries cpuReq = avg(k8s.container.cpu_request), cpuLim = avg(k8s.container.cpu_limit), memReq = avg(k8s.container.memory_request), memLim = avg(k8s.container.memory_limit), by:{k8s.cluster.uid, k8s.namespace.name, k8s.pod.name, k8s.container.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

// Pod cpu/mem usage (summed for cluster totals).
export const clusterPodUsage = (f: Filters = {}) =>
  `timeseries cpu = avg(k8s.pod.cpu.usage), mem = avg(k8s.pod.memory.working_set), by:{k8s.cluster.uid, k8s.namespace.name, k8s.pod.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

// ---- Workloads ------------------------------------------------------------
// Workload filter narrows by the workload's own name dimension.
const wlCond = (f: Filters, nameDim: string): string[] =>
  f.workload ? [`${nameDim}=="${f.workload}"`] : [];

export const deployments = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.deployment.desired), available = avg(k8s.deployment.available), by:{k8s.namespace.name, k8s.deployment.name}${filt([...conds(f, { cluster: true, namespace: true }), ...wlCond(f, "k8s.deployment.name")])}, ${win()}`;

export const statefulsets = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.statefulset.desired_pods), ready = avg(k8s.statefulset.ready_pods), by:{k8s.namespace.name, k8s.statefulset.name}${filt([...conds(f, { cluster: true, namespace: true }), ...wlCond(f, "k8s.statefulset.name")])}, ${win()}`;

export const daemonsets = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.daemonset.desired_scheduled_nodes), ready = avg(k8s.daemonset.ready_nodes), by:{k8s.namespace.name, k8s.daemonset.name}${filt([...conds(f, { cluster: true, namespace: true }), ...wlCond(f, "k8s.daemonset.name")])}, ${win()}`;

// Restarts rolled up per namespace (pod→workload link is unavailable in this feed).
export const restartsByNamespace = (f: Filters = {}) =>
  `timeseries restarts = max(k8s.container.restarts), by:{k8s.namespace.name, k8s.pod.name, k8s.container.name}${filt(conds(f, { cluster: true, namespace: true }))}, ${win()}`;

// Requests/limits per namespace (summed) — workload-level usage is not attributable here.
export const requestsByNamespace = (f: Filters = {}) =>
  `timeseries cpuReq = avg(k8s.container.cpu_request), cpuLim = avg(k8s.container.cpu_limit), memReq = avg(k8s.container.memory_request), memLim = avg(k8s.container.memory_limit), by:{k8s.namespace.name, k8s.pod.name, k8s.container.name}${filt(conds(f, { cluster: true, namespace: true }))}, ${win()}`;

// ---- Pods -----------------------------------------------------------------
export const podsPhase = (f: Filters = {}) =>
  `timeseries phase = avg(k8s.pod.phase), by:{k8s.namespace.name, k8s.pod.name}${filt(conds(f, { cluster: true, namespace: true, pod: true }))}, ${win()}`;

export const podsUsage = (f: Filters = {}) =>
  `timeseries cpu = avg(k8s.pod.cpu.usage), mem = avg(k8s.pod.memory.working_set), by:{k8s.namespace.name, k8s.pod.name}${filt(conds(f, { cluster: true, namespace: true, pod: true }))}, ${win()}`;

export const podsContainers = (f: Filters = {}) =>
  `timeseries restarts = max(k8s.container.restarts), ready = avg(k8s.container.ready), by:{k8s.namespace.name, k8s.pod.name, k8s.container.name}${filt(conds(f, { cluster: true, namespace: true, pod: true }))}, ${win()}`;

// ---- Nodes ----------------------------------------------------------------
// Node metrics carry no cluster/namespace dimension in this feed.
export const nodes = () =>
  `timeseries ready = avg(k8s.node.condition_ready), cpu = avg(k8s.node.cpu.usage), mem = avg(k8s.node.memory.usage), memAvail = avg(k8s.node.memory.available), fsUsed = avg(k8s.node.filesystem.usage), fsCap = avg(k8s.node.filesystem.capacity), by:{k8s.node.name}, ${win()}`;

// ---- Filter bar options (distinct values, cascading) ----------------------
// Each dropdown's options are narrowed by the filters above it so, e.g., picking
// a namespace leaves only that namespace's pods in the Pod dropdown.
export const filterClusters = () =>
  `timeseries v = avg(k8s.pod.phase), by:{k8s.cluster.uid}, ${win()} | fields k8s.cluster.uid | sort k8s.cluster.uid asc`;
export const filterNamespaces = (f: Filters = {}) =>
  `timeseries v = avg(k8s.pod.phase), by:{k8s.namespace.name}${filt(conds(f, { cluster: true }))}, ${win()} | fields k8s.namespace.name | sort k8s.namespace.name asc`;
export const filterWorkloads = (f: Filters = {}) => {
  const c = filt(conds(f, { cluster: true, namespace: true }));
  return `timeseries d = avg(k8s.deployment.desired), by:{name = k8s.deployment.name}${c}, ${win()}
   | append [ timeseries d = avg(k8s.statefulset.desired_pods), by:{name = k8s.statefulset.name}${c}, ${win()} ]
   | append [ timeseries d = avg(k8s.daemonset.desired_scheduled_nodes), by:{name = k8s.daemonset.name}${c}, ${win()} ]
   | dedup name | fields name | sort name asc`;
};
export const filterPods = (f: Filters = {}) =>
  `timeseries v = avg(k8s.pod.phase), by:{k8s.pod.name}${filt(conds(f, { cluster: true, namespace: true }))}, ${win()} | fields k8s.pod.name | sort k8s.pod.name asc`;

// ---- Workload-kind resolution --------------------------------------------
// Pod → workload gives a NAME but not a kind. Probe each workload type for the
// name in the namespace; the page opens the kind that returns rows.
export const workloadKindProbe = (
  kind: "Deployment" | "StatefulSet" | "DaemonSet",
  ns: string,
  name: string
) => {
  if (kind === "StatefulSet")
    return `timeseries v = avg(k8s.statefulset.desired_pods), by:{k8s.statefulset.name}, filter:{in("${name}", k8s.statefulset.name) and in("${ns}", k8s.namespace.name)}, ${win()} | fields k8s.statefulset.name | limit 1`;
  if (kind === "DaemonSet")
    return `timeseries v = avg(k8s.daemonset.desired_scheduled_nodes), by:{k8s.daemonset.name}, filter:{in("${name}", k8s.daemonset.name) and in("${ns}", k8s.namespace.name)}, ${win()} | fields k8s.daemonset.name | limit 1`;
  return `timeseries v = avg(k8s.deployment.desired), by:{k8s.deployment.name}, filter:{in("${name}", k8s.deployment.name) and in("${ns}", k8s.namespace.name)}, ${win()} | fields k8s.deployment.name | limit 1`;
};

// ---- Entity detail (drill-down) ------------------------------------------

export const namespaceLogs = (ns: string) =>
  `fetch logs, ${win()} | filter k8s.namespace.name=="${ns}" | fields timestamp, loglevel, k8s.pod.name, content | sort timestamp desc | limit 200`;

const podF = (ns: string, pod: string) =>
  `filter:{k8s.namespace.name=="${ns}" and k8s.pod.name=="${pod}"}`;

// Pod CPU (pod-level usage).
export const podCpu = (ns: string, pod: string) =>
  `timeseries cpu = avg(k8s.pod.cpu.usage), by:{k8s.namespace.name, k8s.pod.name}, ${podF(ns, pod)}, ${win()}`;

// Pod memory family (usage / working set / rss / available).
export const podMemory = (ns: string, pod: string) =>
  `timeseries usage = avg(k8s.pod.memory.usage), working_set = avg(k8s.pod.memory.working_set), rss = avg(k8s.pod.memory.rss), available = avg(k8s.pod.memory.available), by:{k8s.namespace.name, k8s.pod.name}, ${podF(ns, pod)}, ${win()}`;

// Pod memory page faults.
export const podPageFaults = (ns: string, pod: string) =>
  `timeseries page_faults = avg(k8s.pod.memory.page_faults), major_page_faults = avg(k8s.pod.memory.major_page_faults), by:{k8s.namespace.name, k8s.pod.name}, ${podF(ns, pod)}, ${win()}`;

// Per-container CPU usage (one line per container).
export const podContainerCpu = (ns: string, pod: string) =>
  `timeseries cpu = avg(container.cpu.usage), by:{k8s.container.name}, ${podF(ns, pod)}, ${win()}`;

// Per-container memory working set.
export const podContainerMemory = (ns: string, pod: string) =>
  `timeseries mem = avg(container.memory.working_set), by:{k8s.container.name}, ${podF(ns, pod)}, ${win()}`;

// Per-container requests & limits (CPU + memory).
export const podContainerRequests = (ns: string, pod: string) =>
  `timeseries cpu_request = avg(k8s.container.cpu_request), cpu_limit = avg(k8s.container.cpu_limit), mem_request = avg(k8s.container.memory_request), mem_limit = avg(k8s.container.memory_limit), by:{k8s.container.name}, ${podF(ns, pod)}, ${win()}`;

// Per-container restarts (one line per container).
export const podContainerRestarts = (ns: string, pod: string) =>
  `timeseries restarts = max(k8s.container.restarts), by:{k8s.container.name}, ${podF(ns, pod)}, ${win()}`;

// Node — full metric families.
export const nodeCpu = (node: string) =>
  `timeseries cpu = avg(k8s.node.cpu.usage), by:{k8s.node.name}, filter:{k8s.node.name=="${node}"}, ${win()}`;

export const nodeMemory = (node: string) =>
  `timeseries usage = avg(k8s.node.memory.usage), working_set = avg(k8s.node.memory.working_set), rss = avg(k8s.node.memory.rss), available = avg(k8s.node.memory.available), by:{k8s.node.name}, filter:{k8s.node.name=="${node}"}, ${win()}`;

export const nodeFilesystem = (node: string) =>
  `timeseries usage = avg(k8s.node.filesystem.usage), capacity = avg(k8s.node.filesystem.capacity), available = avg(k8s.node.filesystem.available), by:{k8s.node.name}, filter:{k8s.node.name=="${node}"}, ${win()}`;

export const nodePageFaults = (node: string) =>
  `timeseries page_faults = avg(k8s.node.memory.page_faults), major_page_faults = avg(k8s.node.memory.major_page_faults), by:{k8s.node.name}, filter:{k8s.node.name=="${node}"}, ${win()}`;

export const nodeReady = (node: string) =>
  `timeseries ready = avg(k8s.node.condition_ready), by:{k8s.node.name}, filter:{k8s.node.name=="${node}"}, ${win()}`;

// Workload replicas over time — adds ReplicaSet support.
export const workloadReplicas = (
  kind: "Deployment" | "StatefulSet" | "DaemonSet" | "ReplicaSet",
  ns: string,
  name: string
) => {
  if (kind === "StatefulSet")
    return `timeseries desired = avg(k8s.statefulset.desired_pods), ready = avg(k8s.statefulset.ready_pods), current = avg(k8s.statefulset.current_pods), updated = avg(k8s.statefulset.updated_pods), by:{k8s.namespace.name, k8s.statefulset.name}, filter:{k8s.namespace.name=="${ns}" and k8s.statefulset.name=="${name}"}, ${win()}`;
  if (kind === "DaemonSet")
    return `timeseries desired = avg(k8s.daemonset.desired_scheduled_nodes), ready = avg(k8s.daemonset.ready_nodes), current = avg(k8s.daemonset.current_scheduled_nodes), misscheduled = avg(k8s.daemonset.misscheduled_nodes), by:{k8s.namespace.name, k8s.daemonset.name}, filter:{k8s.namespace.name=="${ns}" and k8s.daemonset.name=="${name}"}, ${win()}`;
  if (kind === "ReplicaSet")
    return `timeseries desired = avg(k8s.replicaset.desired), available = avg(k8s.replicaset.available), by:{k8s.namespace.name, k8s.replicaset.name}, filter:{k8s.namespace.name=="${ns}" and k8s.replicaset.name=="${name}"}, ${win()}`;
  return `timeseries desired = avg(k8s.deployment.desired), available = avg(k8s.deployment.available), by:{k8s.namespace.name, k8s.deployment.name}, filter:{k8s.namespace.name=="${ns}" and k8s.deployment.name=="${name}"}, ${win()}`;
};

// ---- Namespace detail (tabbed, aggregated at namespace level) --------------
const nsF = (ns: string) => `filter:{k8s.namespace.name=="${ns}"}`;

// Namespace phase (for the Overview chip).
export const namespacePhase = (ns: string) =>
  `timeseries v = avg(k8s.namespace.phase), by:{k8s.namespace.name}, ${nsF(ns)}, ${win()}`;

// Namespace aggregate CPU/memory over time.
export const namespaceUsage = (ns: string) =>
  `timeseries cpu = avg(k8s.pod.cpu.usage), mem = avg(k8s.pod.memory.working_set), by:{k8s.namespace.name}, ${nsF(ns)}, ${win()}`;

// Which cluster a namespace belongs to.
export const namespaceCluster = (ns: string) =>
  `timeseries v = avg(k8s.pod.phase), by:{k8s.cluster.uid}, ${nsF(ns)}, ${win()}`;

// Which cluster a pod belongs to.
export const podCluster = (ns: string, pod: string) =>
  `timeseries v = avg(k8s.pod.phase), by:{k8s.cluster.uid}, ${podF(ns, pod)}, ${win()}`;

// Pods in a namespace with phase + usage (Overview pod list + CPU/Memory tops).
export const namespacePodsUsage = (ns: string) =>
  `timeseries phase = avg(k8s.pod.phase), cpu = avg(k8s.pod.cpu.usage), mem = avg(k8s.pod.memory.working_set), by:{k8s.pod.name}, ${nsF(ns)}, ${win()}`;

// Restarts per pod/container in a namespace (Events tab).
export const namespaceRestarts = (ns: string) =>
  `timeseries restarts = max(k8s.container.restarts), by:{k8s.pod.name, k8s.container.name}, ${nsF(ns)}, ${win()}`;

// Requests/limits per pod/container in a namespace (Resource Limits tab).
export const namespaceRequests = (ns: string) =>
  `timeseries cpuReq = avg(k8s.container.cpu_request), cpuLim = avg(k8s.container.cpu_limit), memReq = avg(k8s.container.memory_request), memLim = avg(k8s.container.memory_limit), by:{k8s.pod.name, k8s.container.name}, ${nsF(ns)}, ${win()}`;

// Pods in a namespace (for namespace → pods drilldown). Kept for compatibility.
export const namespacePods = (ns: string) =>
  `timeseries v = avg(k8s.pod.phase), by:{k8s.pod.name}, ${nsF(ns)}, ${win()}`;

// Namespaces in the cluster (for cluster → namespaces drilldown).
export const clusterNamespaces = () =>
  `timeseries v = avg(k8s.namespace.phase), by:{k8s.namespace.name}, ${win()}`;

// ---- Logs -----------------------------------------------------------------
export const podLogs = (ns: string, pod: string) =>
  `fetch logs, ${win()} | filter k8s.namespace.name=="${ns}" and k8s.pod.name=="${pod}" | fields timestamp, loglevel, k8s.container.name, content | sort timestamp desc | limit 200`;

// Node logs — logs carry k8s.node.name in this feed.
export const nodeLogs = (node: string) =>
  `fetch logs, ${win()} | filter k8s.node.name=="${node}" | fields timestamp, loglevel, k8s.namespace.name, k8s.pod.name, content | sort timestamp desc | limit 200`;

// Workload logs — pods are named `<workload>-<rshash>-<suffix>`, so match by prefix.
export const workloadLogs = (ns: string, name: string) =>
  `fetch logs, ${win()} | filter k8s.namespace.name=="${ns}" and startsWith(k8s.pod.name, "${name}-") | fields timestamp, loglevel, k8s.pod.name, content | sort timestamp desc | limit 200`;

// ---- Services tied to an entity (from spans) ------------------------------

export const podServices = (ns: string, pod: string) =>
  `fetch spans, ${win()} | filter k8s.namespace.name=="${ns}" and k8s.pod.name=="${pod}" and isNotNull(service.name) | summarize requests = count(), by:{service.name} | sort requests desc | limit 20`;

export const namespaceServices = (ns: string) =>
  `fetch spans, ${win()} | filter k8s.namespace.name=="${ns}" and isNotNull(service.name) | summarize requests = count(), by:{service.name} | sort requests desc | limit 20`;

export const clusterServices = (uid: string) =>
  `fetch spans, ${win()} | filter k8s.cluster.uid=="${uid}" and isNotNull(service.name) | summarize requests = count(), by:{service.name} | sort requests desc | limit 20`;

// ---- Services (top-level view) --------------------------------------------
// Service-level RED-ish metrics derived from spans. Requests + avg duration are
// one query; failures are a separate query so a missing request.is_failed field
// degrades to "0 errors" instead of breaking the whole list.
export const servicesList = (f: Filters = {}) =>
  `fetch spans, ${win()} | filter isNotNull(service.name)${spanConds(f)} | summarize requests = count(), avgDuration = avg(duration), by:{service.name} | sort requests desc | limit 200`;

export const servicesFailures = (f: Filters = {}) =>
  `fetch spans, ${win()} | filter isNotNull(service.name) and request.is_failed == true${spanConds(f)} | summarize failures = count(), by:{service.name}`;

// Service detail — single-service aggregates and timeseries.
const svcF = (service: string, f: Filters) =>
  `service.name=="${service}"${spanConds(f)}`;

export const serviceStat = (service: string, f: Filters = {}) =>
  `fetch spans, ${win()} | filter ${svcF(service, f)} | summarize requests = count(), avgDuration = avg(duration), by:{service.name}`;

export const serviceFailStat = (service: string, f: Filters = {}) =>
  `fetch spans, ${win()} | filter ${svcF(service, f)} and request.is_failed == true | summarize failures = count()`;

export const serviceRequestsSeries = (service: string, f: Filters = {}) =>
  `fetch spans, ${win()} | filter ${svcF(service, f)} | makeTimeseries requests = count()`;

export const serviceFailuresSeries = (service: string, f: Filters = {}) =>
  `fetch spans, ${win()} | filter ${svcF(service, f)} and request.is_failed == true | makeTimeseries failures = count()`;

export const serviceDurationSeries = (service: string, f: Filters = {}) =>
  `fetch spans, ${win()} | filter ${svcF(service, f)} | makeTimeseries avgDuration = avg(duration)`;

// Pods/namespaces where this service's spans originate.
export const serviceLocations = (service: string, f: Filters = {}) =>
  `fetch spans, ${win()} | filter ${svcF(service, f)} and isNotNull(k8s.pod.name) | summarize requests = count(), by:{k8s.namespace.name, k8s.pod.name} | sort requests desc | limit 50`;

// ---- Events ---------------------------------------------------------------
// k8s object events arrive via the OpenTelemetry Collector's k8sobjectsreceiver
// as logs. Not emitted on this tenant yet → this returns 0 rows (empty-state).
export const k8sEvents = (f: Filters = {}) => {
  const extra: string[] = [];
  if (f.cluster) extra.push(`k8s.cluster.uid=="${f.cluster}"`);
  if (f.namespace) extra.push(`k8s.namespace.name=="${f.namespace}"`);
  const tail = extra.length ? ` and ${extra.join(" and ")}` : "";
  return `fetch logs, ${win()} | filter isNotNull(k8s.event.reason)${tail} | fields timestamp, k8s.event.reason, k8s.event.action, k8s.namespace.name, k8s.object.kind, k8s.object.name, content | sort timestamp desc | limit 200`;
};

// ---- Clusters page: health rollup + workload counts -----------------------
export const deploymentsHealth = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.deployment.desired), available = avg(k8s.deployment.available), by:{k8s.cluster.uid, k8s.namespace.name, k8s.deployment.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

export const statefulsetsByCluster = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.statefulset.desired_pods), by:{k8s.cluster.uid, k8s.namespace.name, k8s.statefulset.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

export const daemonsetsByCluster = (f: Filters = {}) =>
  `timeseries desired = avg(k8s.daemonset.desired_scheduled_nodes), by:{k8s.cluster.uid, k8s.namespace.name, k8s.daemonset.name}${filt(conds(f, { cluster: true }))}, ${win()}`;

// Dynatrace Intelligence problems rolled up per cluster (last 7d). k8s.* fields on problems are
// arrays → summarize by the array field yields its scalar value.
export const clusterProblems = () =>
  `fetch dt.davis.problems, from:now()-7d | summarize total = count(), open = countIf(event.status != "CLOSED"), by:{uid = k8s.cluster.uid}`;

// ---- Recommendations ------------------------------------------------------
// Out-of-memory risk: workloads hit by OOM-kill problems (raise memory limits).
export const recOomRisk = (f: Filters = {}) => {
  const extra: string[] = [];
  if (f.namespace) extra.push(`in("${f.namespace}", k8s.namespace.name)`);
  if (f.workload) extra.push(`in("${f.workload}", k8s.workload.name)`);
  const tail = extra.length ? ` and ${extra.join(" and ")}` : "";
  return `fetch dt.davis.problems, from:now()-7d | filter in("Out-of-memory kills", event.name)${tail} | summarize count = count(), by:{ns = k8s.namespace.name, workload = k8s.workload.name} | sort count desc | limit 50`;
};

// Rightsizing source: one row per container with requests, limits, and current
// usage. Drives Over-provisioned / Near-limit / Missing-limits sections.
// (Container metrics carry no workload dimension, so workload filter is N/A here.)
export const recRightsizing = (f: Filters = {}) =>
  `timeseries cpuReq = avg(k8s.container.cpu_request), cpuLim = avg(k8s.container.cpu_limit), cpuUse = avg(container.cpu.usage), memReq = avg(k8s.container.memory_request), memLim = avg(k8s.container.memory_limit), memWs = avg(container.memory.working_set), by:{k8s.namespace.name, k8s.pod.name, k8s.container.name}${filt(conds(f, { cluster: true, namespace: true }))}, ${win()}`;

// ---- Pod tabs: top memory consumers, problems -----------------------------

// Pod containers ranked by current memory working set (for the Memory tab).
export const podMemoryConsumers = (ns: string, pod: string) =>
  `timeseries m = avg(container.memory.working_set), by:{k8s.container.name}, ${podF(ns, pod)}, ${win()} | fieldsAdd memory = arrayLast(m) | fields k8s.container.name, memory | sort memory desc`;

// Dynatrace Intelligence problems associated with a pod's workload (k8s.* fields on problems are
// arrays, so membership is tested with in(needle, array)). Derive the workload
// from the pod name with deriveWorkload() in lib/series.ts.
export const podProblemsByWorkload = (ns: string, workload: string) =>
  `fetch dt.davis.problems, from:now()-30d | filter in("${workload}", k8s.workload.name) and in("${ns}", k8s.namespace.name) | fields display_id, event.name, event.status, event.category, timestamp | sort timestamp desc | limit 50`;

// Fallback: all problems in a namespace (also used by the Namespace detail tab).
export const podProblemsByNamespace = (ns: string) =>
  `fetch dt.davis.problems, from:now()-30d | filter in("${ns}", k8s.namespace.name) | fields display_id, event.name, event.status, event.category, timestamp | sort timestamp desc | limit 50`;
