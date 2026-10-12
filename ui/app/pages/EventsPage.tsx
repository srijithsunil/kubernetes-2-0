import React, { useMemo } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { ViewShell } from "../components/ViewShell";
import { FilterBar } from "../components/FilterBar";
import * as Q from "../queries/k8s";
import { records, str } from "../lib/series";
import { useFilters, pick } from "../lib/filters";
import { useTimeframe } from "../lib/timeframe";

type EventRow = {
  id: string;
  time: string;
  reason: string;
  object: string;
  namespace: string;
  message: string;
};

export const EventsPage = () => {
  const { filters } = useFilters();
  useTimeframe();
  const f = pick(filters, ["cluster", "namespace"]);
  const { data, error, isLoading } = useDql({ query: Q.k8sEvents(f) });

  const rows = useMemo<EventRow[]>(
    () =>
      records(data).map((r, i) => {
        const kind = str(r["k8s.object.kind"]);
        const name = str(r["k8s.object.name"]);
        return {
          id: String(i),
          time: str(r["timestamp"]),
          reason: str(r["k8s.event.reason"]) || str(r["k8s.event.action"]),
          object: kind || name ? `${kind}/${name}` : "–",
          namespace: str(r["k8s.namespace.name"]),
          message: str(r["content"]),
        };
      }),
    [data]
  );

  const columns = useMemo<DataTableColumnDef<EventRow>[]>(
    () => [
      { id: "time", header: "Time", accessor: "time" },
      { id: "reason", header: "Reason", accessor: "reason" },
      { id: "object", header: "Object", accessor: "object" },
      { id: "namespace", header: "Namespace", accessor: "namespace" },
      { id: "message", header: "Message", accessor: "message" },
    ],
    []
  );

  const empty = !isLoading && !error && rows.length === 0;

  return (
    <ViewShell
      title="Events"
      caption="Kubernetes object events, operator-free, via the OpenTelemetry Collector's k8sobjectsreceiver (surfaced as logs)."
    >
      <FilterBar keys={["cluster", "namespace"]} />
      {error ? <Paragraph>Error: {error.message}</Paragraph> : null}
      {empty ? (
        <Paragraph>
          No Kubernetes object events. This view populates automatically when the OpenTelemetry
          Collector&apos;s <strong>k8sobjectsreceiver</strong> is emitting object events to this tenant.
        </Paragraph>
      ) : (
        <DataTable data={rows} columns={columns} loading={isLoading} sortable />
      )}
    </ViewShell>
  );
};
