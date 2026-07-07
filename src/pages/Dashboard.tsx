import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import "./ExperimentsBoard.css";
import { SearchIcon } from "../components/icons";
import type { Experiment, ExperimentStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";

interface ColumnDef {
  key: ExperimentStatus;
  label: string;
  dot: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "draft", label: "Draft", dot: "#9ca3af" },
  { key: "active", label: "Active", dot: "#4ade80" },
  { key: "review", label: "Review", dot: "#f87171" },
  { key: "complete", label: "Complete", dot: "#93c5fd" },
];

export function Dashboard() {
  const navigate = useNavigate();
  const { activeMember } = useAuth();
  const { experiments, experimentDetails, protocolTemplates, projectRecords, error: labDataError, createExperiment } = useLabData();
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

  const normalizedQuery = query.toLowerCase();
  const matchesQuery = (e: Experiment) =>
    !normalizedQuery ||
    e.name.toLowerCase().includes(normalizedQuery) ||
    e.id.toLowerCase().includes(normalizedQuery) ||
    e.project.toLowerCase().includes(normalizedQuery) ||
    e.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));

  const columns = useMemo(
    () =>
      COLUMNS.map((col) => {
        const cards = experiments
          .filter((e) => e.status === col.key)
          .filter(matchesQuery)
          .map((e) => {
            const detail = experimentDetails[e.id];
            const done = detail?.protocol.filter((s) => s.status === "done").length ?? 0;
            const total = detail?.protocol.length ?? 0;
            return {
              id: e.id,
              name: e.name,
              owner: e.owner,
              modified: e.modified,
              hasProgress: col.key === "active",
              progressPct: total ? Math.round((done / total) * 100) : 0,
            };
          });
        return { ...col, cards };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [experiments, experimentDetails, normalizedQuery],
  );

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

  const canCreateExperiment = !!activeMember && activeMember.status === "active" && activeMember.role !== "viewer" && activeMember.role !== "external";

  return (
    <div className="xb-root">
      <div className="xb-header">
        <h1>Experiments</h1>
        <div className="xb-header-actions">
          <div className="xb-search">
            <SearchIcon color="#6b7280" />
            <input placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="xb-btn-primary" disabled={!canCreateExperiment} onClick={() => canCreateExperiment && setIsCreateOpen(true)}>
            + New
          </button>
        </div>
      </div>

      {labDataError && <div className="xb-error">{labDataError}</div>}

      <div className="xb-columns">
        {columns.map((col) => (
          <div className="xb-column" key={col.key}>
            <div className="xb-column-head">
              <span className="xb-dot" style={{ background: col.dot }} />
              {col.label} · {col.cards.length}
            </div>
            {col.cards.length === 0 && <div className="xb-column-empty">No experiments</div>}
            {col.cards.map((card) => (
              <button type="button" className="xb-card" key={card.id} onClick={() => navigate(`/experiments/${card.id}`)}>
                <div className="xb-card-name">{card.name}</div>
                <div className="xb-card-id">{card.id}</div>
                {card.hasProgress && (
                  <div className="xb-progress-track">
                    <div className="xb-progress-fill" style={{ width: `${card.progressPct}%` }} />
                  </div>
                )}
                <div className="xb-card-meta">
                  {card.owner} · {card.modified}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>

      {isCreateOpen && (
        <div className="xb-modal-backdrop" onMouseDown={closeCreateModal}>
          <form className="xb-modal" onSubmit={submitNewExperiment} onMouseDown={(e) => e.stopPropagation()}>
            <div className="xb-modal-header">
              <div>
                <h2>New Experiment</h2>
                <p>Create a draft record with a protocol checklist and audit trail.</p>
              </div>
              <button type="button" className="xb-modal-close" onClick={closeCreateModal}>
                x
              </button>
            </div>

            {createError && <div className="xb-modal-error">{createError}</div>}

            <label className="xb-field">
              <span>Title</span>
              <input
                value={newExperiment.name}
                onChange={(e) => updateCreateField("name", e.target.value)}
                placeholder="e.g. ELISA cytokine panel - donor set A"
                required
              />
            </label>

            <label className="xb-field">
              <span>Project</span>
              <input
                value={newExperiment.project}
                onChange={(e) => updateCreateField("project", e.target.value)}
                placeholder="e.g. Immunotherapy"
                required
              />
            </label>

            <label className="xb-field">
              <span>Project Record</span>
              <select value={newExperiment.projectId} onChange={(e) => updateCreateField("projectId", e.target.value)}>
                <option value="">No linked project</option>
                {projectRecords.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>

            <div className="xb-field-grid">
              <label className="xb-field">
                <span>Notebook</span>
                <input value={newExperiment.notebook} onChange={(e) => updateCreateField("notebook", e.target.value)} />
              </label>
              <label className="xb-field">
                <span>Due Date</span>
                <input type="date" value={newExperiment.dueDate} onChange={(e) => updateCreateField("dueDate", e.target.value)} />
              </label>
            </div>

            <label className="xb-field">
              <span>Objective</span>
              <textarea
                value={newExperiment.objective}
                onChange={(e) => updateCreateField("objective", e.target.value)}
                placeholder="What question does this run answer?"
                rows={4}
              />
            </label>

            <label className="xb-field">
              <span>Tags</span>
              <input
                value={newExperiment.tags}
                onChange={(e) => updateCreateField("tags", e.target.value)}
                placeholder="PCR, validation, donor A"
              />
            </label>

            <label className="xb-field">
              <span>Protocol Template</span>
              <select
                value={newExperiment.protocolTemplateId}
                onChange={(e) => updateCreateField("protocolTemplateId", e.target.value)}
              >
                <option value="">Default checklist</option>
                {protocolTemplates
                  .filter((template) => template.status === "active")
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} v{template.version}
                    </option>
                  ))}
              </select>
            </label>

            <div className="xb-modal-actions">
              <button type="button" className="xb-btn-secondary" onClick={closeCreateModal}>
                Cancel
              </button>
              <button className="xb-btn-primary" type="submit" disabled={isCreatingExperiment}>
                {isCreatingExperiment ? "Creating..." : "Create Draft"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
