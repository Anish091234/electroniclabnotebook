import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./CompetitivePages.css";
import { SearchIcon } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { useLabData } from "../contexts/LabDataContext";
import { blockSearchText } from "../lib/authoringBlocks";
import type { ExperimentStatus } from "../data/types";

type SearchKind = "Experiment" | "Protocol" | "Inventory" | "Sample" | "Project" | "Comment" | "Attachment" | "Task" | "Audit";

interface SearchResult {
  id: string;
  kind: SearchKind;
  title: string;
  body: string;
  meta: string[];
  path?: string;
  status?: ExperimentStatus;
}

function includes(value: string, query: string) {
  return value.toLowerCase().includes(query);
}

export function Search() {
  const navigate = useNavigate();
  const {
    experimentDetails,
    protocolTemplates,
    inventoryItems,
    sampleRecords,
    projectRecords,
    attachments,
    collaborationTasks,
    auditEvents,
  } = useLabData();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const results = useMemo<SearchResult[]>(() => {
    const all: SearchResult[] = [
      ...Object.values(experimentDetails).map((experiment) => ({
        id: experiment.id,
        kind: "Experiment" as const,
        title: experiment.name,
        body: [experiment.objective, experiment.notes, experiment.observations, experiment.tags.join(" "), experiment.authoringBlocks.map(blockSearchText).join(" ")].join(" "),
        meta: [
          experiment.id,
          experiment.project,
          experiment.owner,
          experiment.status,
          experiment.reviewStatus ?? "none",
          experiment.reviewAssignedToName ?? "",
          experiment.reviewDueDate ?? "",
          experiment.modified,
        ],
        path: `/experiments/${experiment.id}`,
        status: experiment.status,
      })),
      ...Object.values(experimentDetails).flatMap((experiment) =>
        experiment.comments.map((comment) => ({
          id: comment.id,
          kind: "Comment" as const,
          title: `${comment.author} on ${experiment.name}`,
          body: comment.body,
          meta: [experiment.id, comment.postedAt],
          path: `/experiments/${experiment.id}`,
        })),
      ),
      ...protocolTemplates.map((template) => ({
        id: template.id,
        kind: "Protocol" as const,
        title: template.name,
        body: [template.description, template.steps.join(" ")].join(" "),
        meta: [`v${template.version}`, template.status, `${template.steps.length} steps`],
        path: "/protocols",
      })),
      ...inventoryItems.flatMap((item) => [
        {
          id: item.id,
          kind: "Inventory" as const,
          title: item.name,
          body: [item.category, item.vendor, item.catalogNumber].join(" "),
          meta: [item.unit, `${item.lots.length} lots`],
          path: "/inventory",
        },
        ...item.lots.map((lot) => ({
          id: `${item.id}-${lot.id}`,
          kind: "Inventory" as const,
          title: `${item.name} / ${lot.lotNumber}`,
          body: [lot.location, lot.notes, lot.expirationDate, lot.status].join(" "),
          meta: [`${lot.quantity} ${lot.unit}`, lot.status],
          path: "/inventory",
        })),
      ]),
      ...sampleRecords.map((sample) => ({
        id: sample.id,
        kind: "Sample" as const,
        title: sample.name,
        body: [sample.kind, sample.registryId, sample.source, sample.metadata].join(" "),
        meta: [sample.registryId, sample.status, sample.location],
        path: "/registry",
      })),
      ...projectRecords.map((project) => ({
        id: project.id,
        kind: "Project" as const,
        title: project.name,
        body: [project.description, project.notebooks.join(" "), project.folders.join(" "), project.tags.join(" "), project.visibility ?? "lab"].join(" "),
        meta: [project.status, project.visibility ?? "lab", `${project.notebooks.length} notebooks`, `${project.folders.length} folders`],
        path: "/projects",
      })),
      ...attachments.map((file) => ({
        id: file.id,
        kind: "Attachment" as const,
        title: file.fileName,
        body: [file.contentType, file.storagePath, file.uploadedBy].join(" "),
        meta: [`${Math.ceil(file.size / 1024)} KB`, file.uploadedAt],
        path: `/experiments/${file.experimentId}`,
      })),
      ...collaborationTasks.map((task) => ({
        id: task.id,
        kind: "Task" as const,
        title: task.title,
        body: [task.description, task.assigneeName ?? "", task.dueDate ?? ""].join(" "),
        meta: [task.status, task.assigneeName ?? "Unassigned"],
        path: task.experimentId ? `/experiments/${task.experimentId}` : "/collaboration",
      })),
      ...auditEvents.map((event) => ({
        id: event.id,
        kind: "Audit" as const,
        title: event.action,
        body: [
          event.summary,
          event.actorUid ?? "",
          event.deviceId ?? "",
          event.deviceLabel ?? "",
          ...(event.fieldChanges ?? []).map((change) => `${change.field} ${change.before} ${change.after}`),
        ].join(" "),
        meta: [event.actor, event.targetId, event.deviceLabel ?? "Unknown device", event.timestamp],
        path: "/audit-log",
      })),
    ];

    if (!normalizedQuery) return all.slice(0, 25);
    return all
      .filter((item) => includes([item.title, item.body, item.kind, item.meta.join(" ")].join(" "), normalizedQuery))
      .slice(0, 60);
  }, [attachments, auditEvents, collaborationTasks, experimentDetails, inventoryItems, normalizedQuery, projectRecords, protocolTemplates, sampleRecords]);

  const counts = results.reduce<Record<SearchKind, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {} as Record<SearchKind, number>);

  return (
    <>
      <div className="topbar">
        <h1>Global Search</h1>
      </div>
      <div className="workbench-content">
        <div className="workbench-search">
          <SearchIcon size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search experiments, comments, files, samples, inventory, protocols, dates..." autoFocus />
        </div>

        <div className="workbench-pill-row">
          {Object.entries(counts).map(([kind, count]) => (
            <span key={kind} className="workbench-pill primary">{kind}: {count}</span>
          ))}
        </div>

        <div className="workbench-list">
          {results.length === 0 && <div className="empty-row">No matches found.</div>}
          {results.map((result) => (
            <article key={`${result.kind}-${result.id}`} className="workbench-card workbench-result" onClick={() => result.path && navigate(result.path)}>
              <div className="workbench-card-row">
                <div>
                  <h2>
                    {result.title}
                    {result.kind === "Experiment" && (
                      <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 400, color: "var(--color-text-faint)" }}>
                        {result.id}
                      </span>
                    )}
                  </h2>
                  <p>{result.body || "No indexed body text."}</p>
                </div>
                {result.status ? <StatusBadge status={result.status} /> : <span className="workbench-pill primary">{result.kind}</span>}
              </div>
              <div className="workbench-pill-row">
                {result.meta
                  .filter(Boolean)
                  .filter((meta) => meta !== result.status)
                  .map((meta) => <span key={meta} className="workbench-pill">{meta}</span>)}
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
