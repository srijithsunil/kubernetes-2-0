import React, { useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ViewShell } from "../components/ViewShell";
import { DetailSheet, type Selection } from "../components/DetailSheet";
import { detailsColumn } from "../components/detailsColumn";
import { FilterBar } from "../components/FilterBar";
import * as Q from "../queries/k8s";
import { records, lastNum, str, fmtCores, fmtBytes } from "../lib/series";

type NodeRow = {
  id: string;
  node: string;
  ready: string;
  cpu: string;
  mem: string;
  memAvail: string;
  fsUsed: string;
  fsCap: string;
};

export const NodesPage = () => {
  const [sel, setSel] = useState<Selection | null>(null);
  const { data, error, isLoading } = useDql({ query: Q.nodes() });

  const rows = useMemo<NodeRow[]>(() => {
    return records(data)
      .map((r) => {
        const node = str(r["k8s.node.name"]);
        return {
          id: node,
          node,
          ready: (lastNum(r["ready"]) ?? 0) >= 1 ? "Ready" : "Not ready",
          cpu: fmtCores(lastNum(r["cpu"])),
          mem: fmtBytes(lastNum(r["mem"])),
          memAvail: fmtBytes(lastNum(r["memAvail"])),
          fsUsed: fmtBytes(lastNum(r["fsUsed"])),
          fsCap: fmtBytes(lastNum(r["fsCap"])),
        };
      })
      .sort((a, b) => a.node.localeCompare(b.node));
  }, [data]);

  const columns = useMemo<DataTableColumnDef<NodeRow>[]>(
    () => [
      { id: "node", header: "Node", accessor: "node" },
      { id: "ready", header: "Ready", accessor: "ready" },
      { id: "cpu", header: "CPU used", accessor: "cpu" },
      { id: "mem", header: "Mem used", accessor: "mem" },
      { id: "memAvail", header: "Mem available", accessor: "memAvail" },
      { id: "fsUsed", header: "FS used", accessor: "fsUsed" },
      { id: "fsCap", header: "FS capacity", accessor: "fsCap" },
      detailsColumn<NodeRow>((row) => setSel({ type: "node", node: row.node })),
    ],
    []
  );

  const openRow = (id: string | null) => {
    const row = id != null ? rows.find((r) => r.id === id) : undefined;
    if (row) setSel({ type: "node", node: row.node });
  };

  return (
    <ViewShell
      title="Nodes"
      caption="Node readiness and live usage from OTel kubeletstats. Allocatable/capacity is not emitted here, so usage is absolute (not % of capacity). Click a row for detail."
    >
      <FilterBar keys={["cluster"]} />
      {error ? <p>Error: {error.message}</p> : null}
      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        sortable
        rowId={(r) => r.id}
        interactiveRows={{ autoActivate: false }}
        onActiveRowChange={openRow}
      />
      <DetailSheet selection={sel} onDismiss={() => setSel(null)} />
    </ViewShell>
  );
};
