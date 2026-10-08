import React from "react";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components/forms";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import * as Q from "../queries/k8s";
import { records, str } from "../lib/series";
import { useFilters, type FilterKey } from "../lib/filters";

const META: Record<FilterKey, { label: string; field: string; query: () => string }> = {
  cluster: { label: "Cluster", field: "k8s.cluster.uid", query: Q.filterClusters },
  namespace: { label: "Namespace", field: "k8s.namespace.name", query: Q.filterNamespaces },
  workload: { label: "Workload", field: "name", query: Q.filterWorkloads },
  pod: { label: "Pod", field: "k8s.pod.name", query: Q.filterPods },
};

const FilterSelect = ({ fkey, disabledReason }: { fkey: FilterKey; disabledReason?: string }) => {
  const { filters, set } = useFilters();
  const meta = META[fkey];
  const { data } = useDql({ query: meta.query() });
  const options = records(data)
    .map((r) => str(r[meta.field]))
    .filter(Boolean);
  // De-dup + sort defensively.
  const unique = Array.from(new Set(options)).sort((a, b) => a.localeCompare(b));
  const allLabel = `All ${meta.label.toLowerCase()}s`;

  const select = (
    <Select<string>
      name={fkey}
      value={filters[fkey] ?? null}
      onChange={(v) => set(fkey, v ? v : undefined)}
      disabled={disabledReason != null}
      aria-label={`Filter by ${meta.label.toLowerCase()}`}
    >
      <Select.Trigger placeholder={allLabel} />
      <Select.Content>
        <Select.Option value="">{allLabel}</Select.Option>
        {unique.map((o) => (
          <Select.Option key={o} value={o}>
            {fkey === "cluster" ? o.slice(0, 8) : o}
          </Select.Option>
        ))}
      </Select.Content>
    </Select>
  );

  return (
    <Flex flexDirection="column" gap={2} width={220}>
      <Text textStyle="small">{meta.label}</Text>
      {disabledReason ? (
        <Tooltip text={disabledReason}>
          <span>{select}</span>
        </Tooltip>
      ) : (
        select
      )}
    </Flex>
  );
};

/**
 * Persistent filter bar. `keys` are the dropdowns to show for this page;
 * `disabled` maps a key to a tooltip reason when it should be greyed out
 * (e.g. Workload on the Pods page, where pod→workload linkage is absent).
 */
export const FilterBar = ({
  keys,
  disabled = {},
}: {
  keys: FilterKey[];
  disabled?: Partial<Record<FilterKey, string>>;
}) => {
  return (
    <Flex gap={16} flexWrap="wrap" alignItems="flex-end">
      {keys.map((k) => (
        <FilterSelect key={k} fkey={k} disabledReason={disabled[k]} />
      ))}
    </Flex>
  );
};
