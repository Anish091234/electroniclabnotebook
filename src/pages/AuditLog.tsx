import { useMemo, useState } from "react";
import "./Dashboard.css";
import "./AuditLog.css";
import { SearchIcon } from "../components/icons";
import type { AuditEventKind } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";

type AuditFilter = "all" | AuditEventKind;

const FILTERS: { key: AuditFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "experiment", label: "Experiments" },
  { key: "protocol", label: "Protocols" },
  { key: "comment", label: "Comments" },
  { key: "system", label: "System" },
];

function shortId(value?: string) {
  if (!value) return "unknown";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

export function AuditLog() {
  const { auditEvents } = useLabData();
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [query, setQuery] = useState("");

  const stats = useMemo(
    () => [
      { label: "Total Events", value: auditEvents.length },
      { label: "Experiment Events", value: auditEvents.filter((event) => event.kind === "experiment").length },
      { label: "Tracked Devices", value: new Set(auditEvents.map((event) => event.deviceId).filter(Boolean)).size },
      { label: "Field Changes", value: auditEvents.reduce((total, event) => total + (event.fieldChanges?.length ?? 0), 0) },
    ],
    [auditEvents],
  );

  const filteredEvents = auditEvents.filter((event) => {
    const normalizedQuery = query.toLowerCase();
    const matchesFilter = filter === "all" || event.kind === filter;
    const changeText = (event.fieldChanges ?? [])
      .map((change) => `${change.field} ${change.before} ${change.after}`)
      .join(" ")
      .toLowerCase();
    const matchesQuery =
      event.action.toLowerCase().includes(normalizedQuery) ||
      event.actor.toLowerCase().includes(normalizedQuery) ||
      (event.actorUid ?? "").toLowerCase().includes(normalizedQuery) ||
      event.targetId.toLowerCase().includes(normalizedQuery) ||
      event.targetLabel.toLowerCase().includes(normalizedQuery) ||
      (event.targetType ?? "").toLowerCase().includes(normalizedQuery) ||
      (event.deviceId ?? "").toLowerCase().includes(normalizedQuery) ||
      (event.deviceLabel ?? "").toLowerCase().includes(normalizedQuery) ||
      event.summary.toLowerCase().includes(normalizedQuery) ||
      changeText.includes(normalizedQuery);

    return matchesFilter && matchesQuery;
  });

  return (
    <>
      <div className="topbar">
        <h1>Audit Log</h1>
        <div className="topbar-actions">
          <div className="search-box">
            <SearchIcon />
            <input
              placeholder="Search audit trail..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="audit-log-content">
        <div className="audit-summary-grid">
          {stats.map((stat) => (
            <div key={stat.label} className="audit-summary-item">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>

        <div className="audit-filter-tabs">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              className={`audit-filter-tab${filter === item.key ? " active" : ""}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="audit-event-list">
          {filteredEvents.length === 0 && (
            <div className="audit-empty">No audit events match the current filters.</div>
          )}

          {filteredEvents.map((event) => (
            <article key={event.id} className="audit-event">
              <div className={`audit-event-kind ${event.kind}`}>{event.kind}</div>
              <div className="audit-event-main">
                <div className="audit-event-title-row">
                  <h2>{event.action}</h2>
                  <span>{event.timestamp}</span>
                </div>
                <p>{event.summary}</p>
                {(event.fieldChanges?.length ?? 0) > 0 && (
                  <div className="audit-change-list">
                    {event.fieldChanges?.map((change, index) => (
                      <div key={`${event.id}-${change.field}-${index}`} className="audit-change-row">
                        <strong>{change.field}</strong>
                        <span>{change.before}</span>
                        <span>{change.after}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="audit-event-meta">
                  <span>User: {event.actor}</span>
                  <span>UID: {shortId(event.actorUid)}</span>
                  <span>Device: {event.deviceLabel ?? "Unknown device"}</span>
                  <span>Device ID: {shortId(event.deviceId)}</span>
                  {event.versionNumber ? <span>Revision: {event.versionNumber}</span> : null}
                  <span>{event.targetId}</span>
                  <span>{event.targetLabel}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
