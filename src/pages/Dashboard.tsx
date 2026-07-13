import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./CompetitivePages.css";
import { StatusBadge } from "../components/StatusBadge";
import { SearchIcon, AlertIcon } from "../components/icons";
import type { ExperimentStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";

type TabKey = "all" | "active" | "review" | "complete" | "draft";
type AttentionTone = "urgent" | "normal";

interface AttentionItem {
  id: string;
  title: string;
  body: string;
  action: string;
  experimentId: string;
  tone: AttentionTone;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { activeMember } = useAuth();
  const { experiments, experimentDetails, protocolTemplates, projectRecords, error: labDataError, createExperiment } = useLabData();
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingExperiment, setIsCreatingExperiment] = useState(false);
  const [newExperiment, setNewExperiment] = useState({
    name: "",
    project: "",
    objective: "",
    tags: "",
    protocolTemplateId: "",
    projectId: "",
    notebook: "General Notebook",
    dueDate: "",
  });

  const tabs: { key: TabKey; label: string; count: number }[] = useMemo(
    () => [
      { key: "all", label: "All", count: experiments.length },
      {
        key: "active",
        label: "Active",
        count: experiments.filter((e) => e.status === "active").length,
      },
      {
        key: "review",
        label: "Review",
        count: experiments.filter((e) => e.status === "review").length,
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
    [experiments],
  );

  const statusFilter: Record<TabKey, ExperimentStatus | null> = {
    all: null,
    active: "active",
    review: "review",
    complete: "complete",
    draft: "draft",
  };

  const stats = useMemo(() => {
    const activeCount = experiments.filter((e) => e.status === "active").length;
    const reviewCount = experiments.filter((e) => e.status === "review").length;
    const completedSteps = Object.values(experimentDetails).reduce(
      (total, detail) => total + detail.protocol.filter((step) => step.status === "done").length,
      0,
    );
    const collaborators = new Set(experiments.map((e) => e.owner)).size;
    const aiInsights = Object.values(experimentDetails).reduce((total, detail) => total + detail.aiInsights.length, 0);

    return [
      { label: "Active", value: String(activeCount), note: `${reviewCount} in review`, noteColor: "positive" },
      { label: "Protocol Steps", value: String(completedSteps), note: "Completed in Firestore", noteColor: "neutral" },
      { label: "Collaborators", value: String(collaborators), note: "Across projects", noteColor: "neutral" },
      { label: "AI Insights", value: String(aiInsights), note: "Available now", noteColor: "accent" },
    ];
  }, [experimentDetails, experiments]);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    if (!activeMember?.uid) return [];
    const now = new Date();
    const details = Object.values(experimentDetails);
    const reviewAssignments = details
      .filter((detail) => detail.reviewStatus === "requested" && detail.reviewAssignedToUid === activeMember.uid)
      .map((detail) => ({
        id: `review-${detail.id}`,
        title: "Independent review is waiting",
        body: `${detail.name} was assigned to you for review${detail.reviewDueDate ? ` by ${detail.reviewDueDate}` : ""}.`,
        action: "Review record",
        experimentId: detail.id,
        tone: "urgent" as const,
      }));
    const rejectedRecords = details
      .filter((detail) => detail.reviewStatus === "rejected" && detail.ownerUid === activeMember.uid && !detail.locked)
      .map((detail) => ({
        id: `rework-${detail.id}`,
        title: "Changes were requested",
        body: `${detail.name} is back in your workspace with reviewer feedback to address.`,
        action: "Resolve changes",
        experimentId: detail.id,
        tone: "urgent" as const,
      }));
    const dueRecords = details
      .filter((detail) => {
        if (detail.ownerUid !== activeMember.uid || detail.locked || !detail.dueDate) return false;
        const dueAt = new Date(`${detail.dueDate}T23:59:59`);
        return !Number.isNaN(dueAt.getTime()) && dueAt <= now;
      })
      .map((detail) => ({
        id: `due-${detail.id}`,
        title: "Experiment due for attention",
        body: `${detail.name} was due ${detail.dueDate}. Review its readiness and next step.`,
        action: "Open experiment",
        experimentId: detail.id,
        tone: "normal" as const,
      }));

    return [...reviewAssignments, ...rejectedRecords, ...dueRecords].slice(0, 3);
  }, [activeMember?.uid, experimentDetails]);

  const filtered = experiments.filter((e) => {
    const normalizedQuery = query.toLowerCase();
    const matchesTab = statusFilter[tab] === null || e.status === statusFilter[tab];
    const matchesQuery =
      e.name.toLowerCase().includes(normalizedQuery) ||
      e.id.toLowerCase().includes(normalizedQuery) ||
      e.project.toLowerCase().includes(normalizedQuery) ||
      e.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
    return matchesTab && matchesQuery;
  });

  const updateCreateField = (field: keyof typeof newExperiment, value: string) => {
    setNewExperiment((prev) => ({ ...prev, [field]: value }));
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setCreateError(null);
    setIsCreatingExperiment(false);
    setNewExperiment({ name: "", project: "", objective: "", tags: "", protocolTemplateId: "", projectId: "", notebook: "General Notebook", dueDate: "" });
  };

  const submitNewExperiment = async (e: FormEvent) => {
    e.preventDefault();
    if (isCreatingExperiment) return;

    setCreateError(null);
    setIsCreatingExperiment(true);

    try {
      const created = await createExperiment({
        name: newExperiment.name,
        project: newExperiment.project,
        objective:
          newExperiment.objective ||
          "Draft objective. Capture the hypothesis, materials, expected outputs, and success criteria before running.",
        tags: newExperiment.tags.split(","),
        protocolTemplateId: newExperiment.protocolTemplateId || undefined,
        projectId: newExperiment.projectId || undefined,
        notebook: newExperiment.notebook,
        dueDate: newExperiment.dueDate || undefined,
      });
      closeCreateModal();
      navigate(`/experiments/${created.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create experiment.";
      setCreateError(
        message.includes("Missing or insufficient permissions") || message.includes("permission-denied")
          ? "Firebase denied the create request. Deploy the Firestore rules in this repo, then try again."
          : message,
      );
      setIsCreatingExperiment(false);
    }
  };

  const latestExperiment = experiments[0];
  const canCreateExperiment = !!activeMember && activeMember.status === "active" && activeMember.role !== "viewer" && activeMember.role !== "external";

  return (
    <>
      <div className="topbar">
        <h1>My Experiments</h1>
        <div className="topbar-actions">
          <div className="search-box">
            <SearchIcon />
            <input
              placeholder="Search experiments..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn-primary" disabled={!canCreateExperiment} onClick={() => canCreateExperiment && setIsCreateOpen(true)}>
            + New Experiment
          </button>
        </div>
      </div>

      <div className="dashboard-content">
        {labDataError && <div className="modal-error">{labDataError}</div>}

        <div className="stats-grid">
          {stats.map((s) => (
            <div key={s.label} className={`stat-card${s.noteColor === "accent" ? " accent" : ""}`}>
              <div className="stat-card-label">{s.label}</div>
              <div className="stat-card-value">{s.value}</div>
              <div className={`stat-card-note${s.noteColor === "positive" ? " positive" : ""}`}>{s.note}</div>
            </div>
          ))}
        </div>

        <section className="attention-queue" aria-labelledby="attention-queue-title">
          <div className="attention-queue-heading">
            <div>
              <span>WORK QUEUE</span>
              <h2 id="attention-queue-title">What needs your attention</h2>
            </div>
            {attentionItems.length > 0 && <span className="attention-count">{attentionItems.length}</span>}
          </div>
          {attentionItems.length > 0 ? (
            <div className="attention-list">
              {attentionItems.map((item) => (
                <button key={item.id} className={`attention-item ${item.tone}`} onClick={() => navigate(`/experiments/${item.experimentId}`)}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </div>
                  <span className="attention-action">{item.action} →</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="attention-empty">No assigned reviews, requested changes, or overdue experiments right now.</p>
          )}
        </section>

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
            <div className="ai-banner-title">Deterministic readiness checks are enabled</div>
            <div className="ai-banner-body">
              {latestExperiment
                ? `Open ${latestExperiment.id} to review protocol completion, notes, and attachments.`
                : "Create an experiment to generate deterministic AI readiness suggestions."}
            </div>
          </div>
          <button
            className="ai-banner-action"
            disabled={!latestExperiment}
            onClick={() => latestExperiment && navigate(`/experiments/${latestExperiment.id}`)}
          >
            View Analysis -&gt;
          </button>
        </div>
      </div>

      {isCreateOpen && (
        <div className="modal-backdrop" onMouseDown={closeCreateModal}>
          <form className="experiment-modal" onSubmit={submitNewExperiment} onMouseDown={(e) => e.stopPropagation()}>
            <div className="experiment-modal-header">
              <div>
                <h2>New Experiment</h2>
                <p>Create a draft record with a protocol checklist and audit trail.</p>
              </div>
              <button type="button" className="modal-close" onClick={closeCreateModal}>
                x
              </button>
            </div>

            {createError && <div className="modal-error">{createError}</div>}

            <label className="modal-field">
              <span>Title</span>
              <input
                value={newExperiment.name}
                onChange={(e) => updateCreateField("name", e.target.value)}
                placeholder="e.g. ELISA cytokine panel - donor set A"
                required
              />
            </label>

            <label className="modal-field">
              <span>Project</span>
              <input
                value={newExperiment.project}
                onChange={(e) => updateCreateField("project", e.target.value)}
                placeholder="e.g. Immunotherapy"
                required
              />
            </label>

            <label className="modal-field">
              <span>Project Record</span>
              <select value={newExperiment.projectId} onChange={(e) => updateCreateField("projectId", e.target.value)}>
                <option value="">No linked project</option>
                {projectRecords.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>

            <div className="workbench-form-grid">
              <label className="modal-field">
                <span>Notebook</span>
                <input value={newExperiment.notebook} onChange={(e) => updateCreateField("notebook", e.target.value)} />
              </label>
              <label className="modal-field">
                <span>Due Date</span>
                <input type="date" value={newExperiment.dueDate} onChange={(e) => updateCreateField("dueDate", e.target.value)} />
              </label>
            </div>

            <label className="modal-field">
              <span>Objective</span>
              <textarea
                value={newExperiment.objective}
                onChange={(e) => updateCreateField("objective", e.target.value)}
                placeholder="What question does this run answer?"
                rows={4}
              />
            </label>

            <label className="modal-field">
              <span>Tags</span>
              <input
                value={newExperiment.tags}
                onChange={(e) => updateCreateField("tags", e.target.value)}
                placeholder="PCR, validation, donor A"
              />
            </label>

            <label className="modal-field">
              <span>Protocol Template</span>
              <select
                value={newExperiment.protocolTemplateId}
                onChange={(e) => updateCreateField("protocolTemplateId", e.target.value)}
              >
                <option value="">Default checklist</option>
                {protocolTemplates
                  .filter((template) => template.status === "active" && template.steps.some((step) => step.trim()))
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} v{template.version}
                    </option>
                  ))}
              </select>
            </label>

            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={closeCreateModal}>
                Cancel
              </button>
              <button className="btn-primary" type="submit" disabled={isCreatingExperiment}>
                {isCreatingExperiment ? "Creating..." : "Create Draft"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
