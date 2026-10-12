import React, { useEffect, useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components/forms";
import { TextInput } from "@dynatrace/strato-components/forms";
import { ViewShell } from "../components/ViewShell";
import { FilterBar } from "../components/FilterBar";
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
  content: string;
};

export const LogsPage = () => {
  const { filters } = useFilters();
  useTimeframe();
  const f = pick(filters, ["cluster", "namespace", "pod"]);

  const [status, setStatus] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

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
      { id: "content", header: "Content", accessor: "content", minWidth: 400 },
    ],
    []
  );

  return (
    <ViewShell
      title="Logs"
      caption="Kubernetes pod logs from the OTel feed (last 30 minutes). Filter by cluster, namespace, pod, status, or search the content."
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
      </Flex>
      {logs.error ? <p>Error: {logs.error.message}</p> : null}
      <DataTable data={rows} columns={columns} loading={logs.isLoading} sortable />
    </ViewShell>
  );
};
