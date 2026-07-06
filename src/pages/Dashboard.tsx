import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import { dashboardStats, dashboardAIBanner, experiments } from "../data/mockData";
import { StatusBadge } from "../components/StatusBadge";
import { SearchIcon, AlertIcon } from "../components/icons";
import type { ExperimentStatus } from "../data/types";

type TabKey = "all" | "active" | "complete" | "draft";

export function Dashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");

  const tabs: { key: TabKey; label: string; count: number }[] = useMemo(
    () => [
      { key: "all", label: "All", count: experiments.length },
      {
        key: "active",
        label: "Active",
        count: experiments.filter((e) => e.status === "active").length,
      },
      {
        key: "complete",
        label: "Complete",
        count: experiments.filter((e) => e.status === "complete").length,
      },
      {
        key: "draft",
        label: "Draft",
        count: experiments.filter((e) => e.status === "draft").length,
      },
    ],
    [],
  );

  const statusFilter: Record<TabKey, ExperimentStatus | null> = {
    all: null,
    active: "active",
    complete: "complete",
    draft: "draft",
  };

  const filtered = experiments.filter((e) => {
    const matchesTab = statusFilter[tab] === null || e.status === statusFilter[tab];
    const matchesQuery = e.name.toLowerCase().includes(query.toLowerCase()) || e.id.toLowerCase().includes(query.toLowerCase());
    return matchesTab && matchesQuery;
  });

  return (
    <>
      <div className="topbar">
        <h1>My Experiments</h1>
        <div className="topbar-actions">
          <div className="search-box">
            <SearchIcon />
            <input
              placeholder="Search experiments…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn-primary">+ New Experiment</button>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="stats-grid">
          {dashboardStats.map((s) => (
            <div key={s.label} className={`stat-card${s.noteColor === "accent" ? " accent" : ""}`}>
              <div className="stat-card-label">{s.label}</div>
              <div className="stat-card-value">{s.value}</div>
              <div className={`stat-card-note${s.noteColor === "positive" ? " positive" : ""}`}>{s.note}</div>
            </div>
          ))}
        </div>

        <div className="filter-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`filter-tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div className="experiments-table-wrap">
          <table className="experiments-table">
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Project</th>
                <th>Status</th>
                <th>Modified</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-row">
                    No experiments match your search.
                  </td>
                </tr>
              )}
              {filtered.map((exp) => (
                <tr key={exp.id} onClick={() => navigate(`/experiments/${exp.id}`)}>
                  <td>
                    <div className="exp-name">{exp.name}</div>
                    <div className="exp-id">{exp.id}</div>
                  </td>
                  <td className="exp-project">{exp.project}</td>
                  <td>
                    <StatusBadge status={exp.status} />
                  </td>
                  <td className="exp-modified">{exp.modified}</td>
                  <td className="exp-owner">{exp.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ai-banner">
          <div className="ai-banner-icon">
            <AlertIcon />
          </div>
          <div style={{ flex: 1 }}>
            <div className="ai-banner-title">{dashboardAIBanner.title}</div>
            <div className="ai-banner-body">{dashboardAIBanner.body}</div>
          </div>
          <button
            className="ai-banner-action"
            onClick={() => navigate("/experiments/EXP-2026-0142")}
          >
            {dashboardAIBanner.actionLabel}
          </button>
        </div>
      </div>
    </>
  );
}
