import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./CompetitivePages.css";
import type { ProjectRecord, ProjectStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  status: "active" as ProjectStatus,
  notebooks: "General Notebook",
  folders: "Planning, Runs, Reports",
  tags: "",
};

export function Projects() {
  const navigate = useNavigate();
  const { activeMember } = useAuth();
  const { projectRecords, experiments, saveProjectRecord } = useLabData();
  const [form, setForm] = useState(EMPTY_FORM);
  const canManageProjects = activeMember?.role === "owner" || activeMember?.role === "admin" || activeMember?.role === "pi";

  const edit = (project: ProjectRecord) => {
    setForm({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      notebooks: project.notebooks.join(", "),
      folders: project.folders.join(", "),
      tags: project.tags.join(", "),
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await saveProjectRecord({
      id: form.id || undefined,
      name: form.name,
      description: form.description,
      status: form.status,
      notebooks: form.notebooks.split(","),
      folders: form.folders.split(","),
      tags: form.tags.split(","),
    });
    setForm(EMPTY_FORM);
  };

  return (
    <>
      <div className="topbar">
        <h1>Projects</h1>
      </div>
      <div className="workbench-content">
        <div className={`workbench-grid${canManageProjects ? "" : " compact"}`}>
          {canManageProjects && (
            <form className="workbench-panel" onSubmit={submit}>
              <h2>{form.id ? "Edit Project" : "New Project"}</h2>
              <label className="modal-field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="modal-field"><span>Description</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></label>
              <div className="workbench-form-grid">
                <label className="modal-field">
                  <span>Status</span>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="modal-field"><span>Tags</span><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
              </div>
              <label className="modal-field"><span>Notebooks</span><input value={form.notebooks} onChange={(e) => setForm({ ...form, notebooks: e.target.value })} /></label>
              <label className="modal-field"><span>Folders / Studies</span><input value={form.folders} onChange={(e) => setForm({ ...form, folders: e.target.value })} /></label>
              <div className="experiment-modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setForm(EMPTY_FORM)}>Reset</button>
                <button className="btn-primary" type="submit">Save Project</button>
              </div>
            </form>
          )}

          <div className="workbench-list">
            {projectRecords.length === 0 && <div className="empty-row">No projects yet.</div>}
            {projectRecords.map((project) => {
              const projectExperiments = experiments.filter((experiment) => experiment.projectId === project.id || experiment.project === project.name);
              return (
                <article key={project.id} className="workbench-card">
                  <div className="workbench-card-row">
                    <div>
                      <h2>{project.name}</h2>
                      <p>{project.description || "No description."}</p>
                    </div>
                    <span className="workbench-pill primary">{project.status}</span>
                  </div>
                  <div className="workbench-pill-row">
                    <span className="workbench-pill">{projectExperiments.length} experiments</span>
                    {project.notebooks.map((notebook) => <span key={notebook} className="workbench-pill">{notebook}</span>)}
                    {project.folders.map((folder) => <span key={folder} className="workbench-pill">{folder}</span>)}
                  </div>
                  <div className="workbench-actions">
                    {canManageProjects && <button className="btn-secondary" onClick={() => edit(project)}>Edit</button>}
                    <button className="btn-secondary" onClick={() => navigate("/dashboard")}>View Experiments</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
