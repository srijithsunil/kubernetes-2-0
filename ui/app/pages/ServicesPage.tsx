import React, { useMemo, useState } from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { ViewShell } from "../components/ViewShell";
import { DetailSheet, type Selection } from "../components/DetailSheet";
import { detailsColumn } from "../components/detailsColumn";
import { FilterBar } from "../components/FilterBar";
import { SummaryBar, type SummaryStatus } from "../components/SummaryBar";
import * as Q from "../queries/k8s";
import { records, lastNum, str, fmtDuration, fmtThousands } from "../lib/series";
import { useFilters, pick } from "../lib/filters";
import { useTimeframe } from "../lib/timeframe";

type ServiceRow = {
  id: string;
  service: string;
  requests: number;
  failures: number;
  errorRate: number; // percent
  avgDuration: number | null; // ns
  _status: SummaryStatus;
};

const errStatus = (rate: number): SummaryStatus =>
  rate > 5 ? "critical" : rate > 1 ? "warning" : "good";

export const ServicesPage = () => {
  const [sel, setSel] = useState<Selection | null>(null);
  const { filters } = useFilters();
  useTimeframe(); // re-run queries when the global timeframe changes
  const f = pick(filters, ["cluster", "namespace"]);
  const list = useDql({ query: Q.servicesList(f) });
  const fails = useDql({ query: Q.servicesFailures(f) });

  const loading = list.isLoading;
  const error = list.error;

  const rows = useMemo<ServiceRow[]>(() => {
    const failMap = new Map<string, number>();
    // A missing request.is_failed field makes this query error — treat as 0 failures.
    if (!fails.error) {
      for (const r of records(fails.data)) {
        failMap.set(str(r["service.name"]), Math.round(lastNum(r["failures"]) ?? 0));
      }
    }
    return records(list.data)
      .map((r) => {
        const service = str(r["service.name"]);
        const requests = Math.round(lastNum(r["requests"]) ?? 0);
        const failures = failMap.get(service) ?? 0;
        const errorRate = requests > 0 ? (failures / requests) * 100 : 0;
        return {
          id: service,
          service,
          requests,
          failures,
          errorRate,
          avgDuration: lastNum(r["avgDuration"]),
          _status: errStatus(errorRate),
        };
      })
      .filter((r) => r.service)
      .sort((a, b) => b.requests - a.requests);
  }, [list.data, fails.data, fails.error]);

  const summary = useMemo(() => {
    const totalReq = rows.reduce((t, r) => t + r.requests, 0);
    const totalFail = rows.reduce((t, r) => t + r.failures, 0);
    const rate = totalReq > 0 ? (totalFail / totalReq) * 100 : 0;
    const unhealthy = rows.filter((r) => r.errorRate > 1).length;
    return { services: rows.length, totalReq, totalFail, rate, unhealthy };
  }, [rows]);

  const columns = useMemo<DataTableColumnDef<ServiceRow>[]>(
    () => [
      { id: "service", header: "Service", accessor: "service" },
      {
        id: "requests",
        header: "Requests",
        accessor: "requests",
        cell: ({ rowData }) => <>{fmtThousands(rowData.requests)}</>,
      },
      { id: "failures", header: "Failures", accessor: "failures" },
      {
        id: "errorRate",
        header: "Error rate",
        accessor: (r) => `${r.errorRate.toFixed(1)}%`,
      },
      {
        id: "avgDuration",
        header: "Avg duration",
        accessor: (r) => fmtDuration(r.avgDuration),
      },
      detailsColumn<ServiceRow>((row) => setSel({ type: "service", service: row.service })),
    ],
    []
  );

  const openRow = (id: string | null) => {
    const row = id != null ? rows.find((r) => r.id === id) : undefined;
    if (row) setSel({ type: "service", service: row.service });
  };

  return (
    <ViewShell
      title="Services"
      caption="Services observed from distributed-tracing spans on your Kubernetes workloads. Click a row for request, error and latency trends plus the pods serving it."
    >
      <FilterBar keys={["cluster", "namespace"]} />
      <SummaryBar
        segments={[
          { label: "Services", value: summary.services, status: summary.unhealthy > 0 ? "warning" : "good" },
          { label: "Requests", value: fmtThousands(summary.totalReq), status: "good" },
          { label: "Failures", value: summary.totalFail, status: summary.totalFail > 0 ? "warning" : "good" },
          { label: "Error rate", value: `${summary.rate.toFixed(1)}%`, status: errStatus(summary.rate) },
          { label: "Degraded (>1%)", value: summary.unhealthy, status: summary.unhealthy > 0 ? "warning" : "good" },
        ]}
      />
      {error ? <p>Error: {error.message}</p> : null}
      {!loading && rows.length === 0 && !error ? (
        <p>
          No service spans in the selected timeframe. This view populates when your workloads emit
          OpenTelemetry traces carrying a service.name.
        </p>
      ) : null}
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
