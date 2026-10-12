import React, { useEffect, useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components/forms";
import { TextInput } from "@dynatrace/strato-components/forms";
import { Button } from "@dynatrace/strato-components/buttons";
import { ExternalLinkIcon } from "@dynatrace/strato-icons";
import { ViewShell } from "../components/ViewShell";
import { FilterBar } from "../components/FilterBar";
import { SidePanel } from "../components/SidePanel";
import * as Q from "../queries/k8s";
import { records, str } from "../lib/series";
import { useFilters, pick } from "../lib/filters";
import { useTimeframe } from "../lib/timeframe";

type LogRow = {
  id: string;
  timestamp: string;
  loglevel: string;
  namespace: string;
  pod: string;
  container: string;
  traceId: string;
  spanId: string;
  content: string;
};

// A `fetch logs` dt.query hands off to the native query/record viewers so the
// OTel columns come through without re-implementing them here.
const openQuery = (dql: string) => sendIntent({ "dt.query": dql });

// The Distributed Tracing app isn't a dt.query handler, so link to it directly:
// open its trace explorer pre-focused on this record's trace (and span/time).
const openTrace = (row: { traceId: string; spanId: string; timestamp: string }) => {
  if (!row.traceId) return;
  const base = getEnvironmentUrl().replace(/\/+$/, "");
  const params = new URLSearchParams({ v: "requests", traceId: row.traceId });
  if (row.spanId) params.set("treeNodeId", row.spanId);
  if (row.timestamp) params.set("tt", row.timestamp);
  window.open(
    `${base}/ui/apps/dynatrace.distributedtracing/explorer?${params.toString()}`,
    "_blank",
    "noopener"
  );
};

const LogDetail = ({ row, onDismiss }: { row: LogRow; onDismiss: () => void }) => {
  const fields: Array<[string, string]> = [
    ["Time", row.timestamp],
    ["Level", row.loglevel],
    ["Namespace", row.namespace],
    ["Pod", row.pod],
    ["Container", row.container],
    ["Trace ID", row.traceId || "–"],
    ["Span ID", row.spanId || "–"],
  ];
  return (
    <SidePanel show title="Log record" onDismiss={onDismiss} width={620}>
      <Flex flexDirection="column" gap={16}>
        <Flex gap={8} flexWrap="wrap">
          <Button variant="accent" onClick={() => openQuery(Q.logsDrillForRecord(row.namespace, row.pod))}>
            <Button.Prefix>
              <ExternalLinkIcon />
            </Button.Prefix>
            Open in Logs app
          </Button>
          {row.traceId ? (
            <Button variant="emphasized" onClick={() => openTrace(row)}>
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
              View trace
            </Button>
          ) : null}
        </Flex>

        <Flex flexDirection="column" gap={8}>
          {fields.map(([k, v]) => (
            <Flex key={k} gap={12} alignItems="baseline">
              <div style={{ width: 110, flexShrink: 0 }}>
                <Text textStyle="small">{k}</Text>
              </div>
              <Text>{v}</Text>
            </Flex>
          ))}
        </Flex>

        <Flex flexDirection="column" gap={4}>
          <Heading level={4}>Content</Heading>
          <div
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--dt-font-families-monospace, monospace)",
              background: "var(--dt-colors-background-container-neutral-default, #f2f2f5)",
              borderRadius: 8,
              padding: 12,
            }}
          >
            <Text>{row.content}</Text>
          </div>
        </Flex>
      </Flex>
    </SidePanel>
  );
};

export const LogsPage = () => {
  const { filters } = useFilters();
  useTimeframe();
  const f = pick(filters, ["cluster", "namespace", "pod"]);

  const [status, setStatus] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LogRow | null>(null);

  // Debounce the free-text search so we don't fire a DQL query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const levels = useDql({ query: Q.logLevels() });
  const levelOptions = useMemo(
    () =>
      Array.from(
        new Set(records(levels.data).map((r) => str(r["loglevel"])).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [levels.data]
  );

  const logs = useDql({ query: Q.logsList(f, { status, search }) });

  const rows = useMemo<LogRow[]>(
    () =>
      records(logs.data).map((r, i) => ({
        id: `${str(r["timestamp"])}-${i}`,
        timestamp: str(r["timestamp"]),
        loglevel: str(r["loglevel"]) || "–",
        namespace: str(r["k8s.namespace.name"]),
        pod: str(r["k8s.pod.name"]),
        container: str(r["k8s.container.name"]),
        traceId: str(r["trace_id"]),
        spanId: str(r["span_id"]),
        content: str(r["content"]),
      })),
    [logs.data]
  );

  const columns = useMemo<DataTableColumnDef<LogRow>[]>(
    () => [
      { id: "timestamp", header: "Time", accessor: "timestamp", minWidth: 220 },
      { id: "loglevel", header: "Level", accessor: "loglevel", minWidth: 80 },
      { id: "namespace", header: "Namespace", accessor: "namespace", minWidth: 140 },
      { id: "pod", header: "Pod", accessor: "pod", minWidth: 200 },
      { id: "container", header: "Container", accessor: "container", minWidth: 160 },
      { id: "content", header: "Content", accessor: "content", minWidth: 360 },
      {
        id: "trace",
        header: "Trace",
        accessor: "traceId",
        minWidth: 120,
        cell: ({ rowData }) =>
          rowData.traceId ? (
            <Button
              aria-label="View trace"
              onClick={(e) => {
                e.stopPropagation();
                openTrace(rowData);
              }}
            >
              <Button.Prefix>
                <ExternalLinkIcon />
              </Button.Prefix>
              Trace
            </Button>
          ) : (
            <>–</>
          ),
      },
    ],
    []
  );

  return (
    <ViewShell
      title="Logs"
      caption="Kubernetes pod logs from the OTel feed. Click a row to inspect a record, open it in the native Logs app, or jump to its trace. Filter by cluster, namespace, pod, status, or search the content."
    >
      <FilterBar keys={["cluster", "namespace", "pod"]} />
      <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
        <Flex flexDirection="column" gap={2} width={220}>
          <Text textStyle="small">Status</Text>
          <Select<string>
            name="status"
            value={status ?? null}
            onChange={(v) => setStatus(v ? v : undefined)}
            aria-label="Filter by log status"
          >
            <Select.Trigger placeholder="All statuses" />
            <Select.Content>
              <Select.Option value="">All statuses</Select.Option>
              {levelOptions.map((o) => (
                <Select.Option key={o} value={o}>
                  {o}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </Flex>
        <Flex flexDirection="column" gap={2} width={360}>
          <Text textStyle="small">Search content</Text>
          <TextInput
            value={searchInput}
            onChange={(v) => setSearchInput(v)}
            placeholder="Type to search log content…"
          />
        </Flex>
        <Button variant="accent" onClick={() => openQuery(Q.logsDrillQuery(f, { status, search }))}>
          <Button.Prefix>
            <ExternalLinkIcon />
          </Button.Prefix>
          Open in Logs app
        </Button>
      </Flex>
      {logs.error ? <Paragraph>Error: {logs.error.message}</Paragraph> : null}
      <DataTable
        data={rows}
        columns={columns}
        loading={logs.isLoading}
        sortable
        rowId={(r) => r.id}
        interactiveRows={{ autoActivate: false }}
        onActiveRowChange={(id) => {
          const row = id != null ? rows.find((r) => r.id === id) : undefined;
          if (row) setSelected(row);
        }}
      />
      {selected ? <LogDetail row={selected} onDismiss={() => setSelected(null)} /> : null}
    </ViewShell>
  );
};
