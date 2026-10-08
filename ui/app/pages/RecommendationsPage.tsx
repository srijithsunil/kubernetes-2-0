import React, { useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Accordion, Chip, AiResponse } from "@dynatrace/strato-components/content";
import { ViewShell } from "../components/ViewShell";
import { FilterBar } from "../components/FilterBar";
import * as Q from "../queries/k8s";
import { records, str, lastNum, fmtCores, fmtBytes } from "../lib/series";
import { explainEntity, type ExplainResult } from "../ai/explain";
import { useFilters, pick } from "../lib/filters";

// Rightsizing thresholds.
const CPU_OVERPROVISION_RATIO = 0.3; // usage < 30% of request → over-provisioned
const MEM_OVERPROVISION_RATIO = 0.4; // working set < 40% of request → over-provisioned
const MEM_NEAR_LIMIT_RATIO = 0.85; // working set > 85% of limit → at risk

type FindingRow = {
  id: string;
  entity: string; // ns/pod/container
  detail: string;
  metric: string;
};

/** Per-section "Explain with Dynatrace Intelligence" button. */
const ExplainButton = ({ subject, context }: { subject: string; context: string }) => {
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const run = () => {
    setLoading(true);
    setResult(null);
    void explainEntity(`Explain and give remediation guidance for: ${subject}.`, context).then((r) => {
      setResult(r);
      setLoading(false);
    });
  };
  return (
    <Flex flexDirection="column" gap={8}>
      <Flex alignItems="center" gap={8}>
        <Button onClick={run} variant="accent" disabled={loading}>
          {loading ? "Asking Dynatrace Intelligence…" : "Explain with Dynatrace Intelligence"}
        </Button>
        <Text textStyle="small">AI-generated · verify before acting</Text>
      </Flex>
      {result && result.ok ? <AiResponse responseState="static">{result.text}</AiResponse> : null}
      {result && !result.ok ? (
        <Flex flexDirection="column" gap={2}>
          <Paragraph>{result.message}</Paragraph>
          {result.hint ? <Text textStyle="small">{result.hint}</Text> : null}
        </Flex>
      ) : null}
    </Flex>
  );
};

const RecSection = ({
  id,
  title,
  blurb,
  rows,
  loading,
  emptyText,
}: {
  id: string;
  title: string;
  blurb: string;
  rows: FindingRow[];
  loading: boolean;
  emptyText: string;
}) => {
  const columns: DataTableColumnDef<FindingRow>[] = [
    { id: "entity", header: "Container", accessor: "entity" },
    { id: "metric", header: "Signal", accessor: "metric" },
    { id: "detail", header: "Recommendation", accessor: "detail" },
  ];
  const aiContext =
    `${title}. ${rows.length} affected container(s): ` +
    rows.slice(0, 20).map((r) => `${r.entity} (${r.metric})`).join("; ") +
    ".";
  return (
    <Accordion.Section id={id}>
      <Accordion.SectionLabel>
        <Flex alignItems="center" gap={8}>
          <Text>{title}</Text>
          <Chip color={rows.length ? "warning" : "neutral"}>{rows.length}</Chip>
        </Flex>
      </Accordion.SectionLabel>
      <Accordion.SectionContent>
        <Flex flexDirection="column" gap={12} padding={8}>
          <Paragraph>{blurb}</Paragraph>
          {!loading && rows.length === 0 ? (
            <Paragraph>{emptyText}</Paragraph>
          ) : (
            <DataTable data={rows} columns={columns} loading={loading} sortable />
          )}
          {rows.length ? <ExplainButton subject={title.toLowerCase()} context={aiContext} /> : null}
        </Flex>
      </Accordion.SectionContent>
    </Accordion.Section>
  );
};

export const RecommendationsPage = () => {
  const { filters } = useFilters();
  const oom = useDql({ query: Q.recOomRisk(pick(filters, ["namespace", "workload"])) });
  const rightsizing = useDql({ query: Q.recRightsizing(pick(filters, ["cluster", "namespace"])) });

  const oomRows = useMemo<FindingRow[]>(
    () =>
      records(oom.data).map((r, i) => ({
        id: String(i),
        entity: `${str(r["ns"])}/${str(r["workload"])}`,
        metric: `${Math.round(lastNum(r["count"]) ?? 0)} OOM kills (7d)`,
        detail: "Raise the container memory limit or reduce the workload's memory footprint.",
      })),
    [oom.data]
  );

  const { overProvisioned, nearLimit, missingLimits } = useMemo(() => {
    const over: FindingRow[] = [];
    const near: FindingRow[] = [];
    const missing: FindingRow[] = [];
    for (const r of records(rightsizing.data)) {
      const ns = str(r["k8s.namespace.name"]);
      const pod = str(r["k8s.pod.name"]);
      const c = str(r["k8s.container.name"]);
      const entity = `${ns}/${pod}/${c}`;
      const id = entity;
      const cpuReq = lastNum(r["cpuReq"]);
      const cpuLim = lastNum(r["cpuLim"]);
      const cpuUse = lastNum(r["cpuUse"]);
      const memReq = lastNum(r["memReq"]);
      const memLim = lastNum(r["memLim"]);
      const memWs = lastNum(r["memWs"]);

      // Over-provisioned (lower requests)
      if (cpuReq && cpuUse != null && cpuUse < CPU_OVERPROVISION_RATIO * cpuReq) {
        over.push({
          id: id + "-cpu",
          entity,
          metric: `CPU ${fmtCores(cpuUse)} of ${fmtCores(cpuReq)} req (${Math.round((cpuUse / cpuReq) * 100)}%)`,
          detail: "Lower the CPU request to reclaim scheduler capacity.",
        });
      } else if (memReq && memWs != null && memWs < MEM_OVERPROVISION_RATIO * memReq) {
        over.push({
          id: id + "-mem",
          entity,
          metric: `Mem ${fmtBytes(memWs)} of ${fmtBytes(memReq)} req (${Math.round((memWs / memReq) * 100)}%)`,
          detail: "Lower the memory request to reclaim scheduler capacity.",
        });
      }

      // At risk / near memory limit
      if (memLim && memWs != null && memWs > MEM_NEAR_LIMIT_RATIO * memLim) {
        near.push({
          id,
          entity,
          metric: `Mem ${fmtBytes(memWs)} of ${fmtBytes(memLim)} limit (${Math.round((memWs / memLim) * 100)}%)`,
          detail: "Raise the memory limit — the container is close to being OOM-killed.",
        });
      }

      // Missing limits/requests
      const gaps: string[] = [];
      if (cpuLim == null) gaps.push("CPU limit");
      if (memLim == null) gaps.push("memory limit");
      if (cpuReq == null) gaps.push("CPU request");
      if (memReq == null) gaps.push("memory request");
      if (gaps.length) {
        missing.push({
          id,
          entity,
          metric: `No ${gaps.join(", ")}`,
          detail: "Set resource requests and limits so the scheduler and OOM-killer behave predictably.",
        });
      }
    }
    return { overProvisioned: over, nearLimit: near, missingLimits: missing };
  }, [rightsizing.data]);

  const error = oom.error || rightsizing.error;

  return (
    <ViewShell
      title="Recommendations"
      caption="Data-driven, operator-free rightsizing and reliability findings from OTel k8s metrics + Dynatrace Intelligence problems. Each section explains what to change; use Dynatrace Intelligence for detailed guidance."
    >
      <FilterBar
        keys={["cluster", "namespace", "workload"]}
        disabled={{
          workload:
            "Workload filter narrows the OOM-risk section only — container rightsizing metrics carry no workload dimension.",
        }}
      />
      {error ? <Text>Error: {error.message}</Text> : null}
      <Heading level={3}>Workload recommendations</Heading>
      <Accordion multiple>
        <RecSection
          id="oom"
          title="Out-of-memory risk"
          blurb="Workloads that Dynatrace Intelligence flagged with out-of-memory kills in the last 7 days. These containers are hitting their memory limit and being killed."
          rows={oomRows}
          loading={oom.isLoading}
          emptyText="No OOM-kill problems in the last 7 days."
        />
        <RecSection
          id="over"
          title="Over-provisioned (lower requests)"
          blurb={`Containers using far less than they request (CPU < ${CPU_OVERPROVISION_RATIO * 100}% or memory < ${MEM_OVERPROVISION_RATIO * 100}% of request). Lowering requests frees scheduler capacity.`}
          rows={overProvisioned}
          loading={rightsizing.isLoading}
          emptyText="No clearly over-provisioned containers."
        />
        <RecSection
          id="near"
          title="At risk — near memory limit"
          blurb={`Containers whose working set exceeds ${MEM_NEAR_LIMIT_RATIO * 100}% of their memory limit — at risk of being OOM-killed.`}
          rows={nearLimit}
          loading={rightsizing.isLoading}
          emptyText="No containers currently near their memory limit."
        />
        <RecSection
          id="missing"
          title="Missing limits / requests"
          blurb="Containers without CPU/memory requests or limits set. Unbounded containers make scheduling and OOM behavior unpredictable."
          rows={missingLimits}
          loading={rightsizing.isLoading}
          emptyText="All observed containers have requests and limits set."
        />
      </Accordion>
    </ViewShell>
  );
};
