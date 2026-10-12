import React from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "@dynatrace/strato-components/layouts";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import { useTimeframe } from "../lib/timeframe";

export const Header = () => {
  const { tf, setTf } = useTimeframe();
  return (
    <AppHeader>
      <AppHeader.Navigation>
        <AppHeader.Logo as={Link} to="/clusters" />
        <AppHeader.NavigationItem as={Link} to="/services">
          Services
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/clusters">
          Clusters
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/workloads">
          Workloads
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/pods">
          Pods
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/nodes">
          Nodes
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/events">
          Events
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/logs">
          Logs
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/recommendations">
          Recommendations
        </AppHeader.NavigationItem>
      </AppHeader.Navigation>
      <AppHeader.ActionItems>
        <TimeframeSelector
          value={{ from: tf.from, to: tf.to }}
          onChange={(v) =>
            setTf(v ? { from: v.from.value, to: v.to.value } : null)
          }
        />
      </AppHeader.ActionItems>
    </AppHeader>
  );
};
