import { PageLayout } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { AssistPanel } from "./components/AssistPanel";
import { ServicesPage } from "./pages/ServicesPage";
import { ClustersPage } from "./pages/ClustersPage";
import { WorkloadsPage } from "./pages/WorkloadsPage";
import { PodsPage } from "./pages/PodsPage";
import { NodesPage } from "./pages/NodesPage";
import { EventsPage } from "./pages/EventsPage";
import { LogsPage } from "./pages/LogsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { FiltersProvider } from "./lib/filters";
import { TimeframeProvider } from "./lib/timeframe";
import { AssistProvider } from "./lib/assist";

export const App = () => {
  return (
    <TimeframeProvider>
      <FiltersProvider>
        <AssistProvider>
          <PageLayout>
            <PageLayout.Header>
              <Header />
            </PageLayout.Header>
            <PageLayout.Content>
              <Routes>
                <Route path="/" element={<Navigate to="/clusters" replace />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/clusters" element={<ClustersPage />} />
                <Route path="/workloads" element={<WorkloadsPage />} />
                <Route path="/pods" element={<PodsPage />} />
                <Route path="/nodes" element={<NodesPage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/recommendations" element={<RecommendationsPage />} />
              </Routes>
            </PageLayout.Content>
          </PageLayout>
          <AssistPanel />
        </AssistProvider>
      </FiltersProvider>
    </TimeframeProvider>
  );
};
