import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./ProtocolsList.css";
import { protocols, protocolsAIBanner } from "../data/mockData";
import { SearchIcon, AlertIcon } from "../components/icons";

export function ProtocolsList() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<string>("All");
  const [query, setQuery] = useState("");

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(protocols.map((p) => p.category)))],
    [],
  );

  const stats = useMemo(() => {
    const avgSuccess = Math.round(
      protocols.reduce((sum, p) => sum + (p.successRate ?? 0), 0) / protocols.length,
    );
    const mostUsed = protocols.reduce((max, p) => (p.usedCount > max.usedCount ? p : max), protocols[0]);
    return [
      { label: "Total Protocols", value: String(protocols.length), note: "Across all categories" },
      { label: "Categories", value: String(categories.length - 1), note: "Active research areas" },
      { label: "Avg Success Rate", value: `${avgSuccess}%`, note: "Lab-wide", accent: true },
      {
        label: "Most Used",
        value: `${mostUsed.usedCount} runs`,
        note: mostUsed.name.slice(0, 24) + (mostUsed.name.length > 24 ? "…" : ""),
      },
    ];
  }, [categories.length]);

  const filtered = protocols.filter((p) => {
    const matchesCategory = category === "All" || p.category === category;
    const matchesQuery =
      p.name.toLowerCase().includes(query.toLowerCase()) || p.id.toLowerCase().includes(query.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <>
      <div className="topbar">
        <h1>Protocols</h1>
        <div className="topbar-actions">
          <div className="search-box">
            <SearchIcon />
            <input
              placeholder="Search protocols…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn-primary">+ New Protocol</button>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="stats-grid">
          {stats.map((s) => (
            <div key={s.label} className={`stat-card${s.accent ? " accent" : ""}`}>
              <div className="stat-card-label">{s.label}</div>
              <div className="stat-card-value">{s.value}</div>
              <div className="stat-card-note">{s.note}</div>
            </div>
          ))}
        </div>

        <div className="filter-tabs">
          {categories.map((c) => (
            <button
              key={c}
              className={`filter-tab${category === c ? " active" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
              {c !== "All" ? ` (${protocols.filter((p) => p.category === c).length})` : ` (${protocols.length})`}
            </button>
          ))}
        </div>

        <div className="experiments-table-wrap">
          <table className="experiments-table">
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Category</th>
                <th>Version</th>
                <th>Steps</th>
                <th>Success Rate</th>
                <th>Used</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    No protocols match your search.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/protocols/${p.id}`)}>
                  <td>
                    <div className="exp-name">{p.name}</div>
                    <div className="exp-id">{p.id}</div>
                  </td>
                  <td>
                    <span className="category-tag">{p.category}</span>
                  </td>
                  <td>
                    <span className="version-badge">{p.version}</span>
                  </td>
                  <td className="exp-project">{p.stepCount}</td>
                  <td>
                    {p.successRate != null && (
                      <span className={`success-rate ${p.successRate >= 95 ? "high" : "mid"}`}>
                        {p.successRate}%
                      </span>
                    )}
                  </td>
                  <td className="exp-owner">{p.usedCount} runs</td>
                  <td className="exp-modified">{p.lastUpdated}</td>
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
            <div className="ai-banner-title">{protocolsAIBanner.title}</div>
            <div className="ai-banner-body">{protocolsAIBanner.body}</div>
          </div>
          <button className="ai-banner-action" onClick={() => navigate(`/protocols/${protocolsAIBanner.protocolId}`)}>
            {protocolsAIBanner.actionLabel}
          </button>
        </div>
      </div>
    </>
  );
}
