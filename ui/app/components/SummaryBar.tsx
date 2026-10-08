import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { ProgressBar, HealthIndicator } from "@dynatrace/strato-components/content";

export type SummaryStatus = "good" | "warning" | "critical";

const STATUS_HEALTH: Record<SummaryStatus, "good" | "warning" | "critical"> = {
  good: "good",
  warning: "warning",
  critical: "critical",
};
const STATUS_BAR: Record<SummaryStatus, "success" | "warning" | "critical"> = {
  good: "success",
  warning: "warning",
  critical: "critical",
};

export type SummarySegmentData = {
  label: string;
  value: number | string;
  status: SummaryStatus;
};

/** One segment of a summary rollup bar: a labelled count with a health-colored bar. */
export const SummarySegment = ({ label, value, status }: SummarySegmentData) => (
  <Flex flexDirection="column" gap={8} width="25%" minWidth={160}>
    <Flex alignItems="center" justifyContent="space-between">
      <Flex alignItems="center" gap={6}>
        <HealthIndicator status={STATUS_HEALTH[status]} />
        <Text textStyle="small">{label}</Text>
      </Flex>
      <Heading level={4}>{value}</Heading>
    </Flex>
    <ProgressBar value={100} color={STATUS_BAR[status]} aria-label={`${label} health`} />
  </Flex>
);

/** Horizontal rollup of entity-count segments, each with a health-colored bar. */
export const SummaryBar = ({ segments }: { segments: SummarySegmentData[] }) => (
  <Flex gap={24} flexWrap="wrap">
    {segments.map((s) => (
      <SummarySegment key={s.label} {...s} />
    ))}
  </Flex>
);
