import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./CompetitivePages.css";
import type { LabMember } from "../data/accountTypes";
import type { ProjectRecord, ProjectStatus, ProjectVisibility } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";
import { subscribeLabMembers } from "../services/accountService";

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  status: "active" as ProjectStatus,
  visibility: "lab" as ProjectVisibility,
  allowedMemberUids: [] as string[],
  readOnlyShareEnabled: false,
  notebooks: "General Notebook",
  folders: "Planning, Runs, Reports",
  tags: "",
};

export function Projects() {
  const navigate = useNavigate();
  const { activeLab, activeMember } = useAuth();
  const { projectRecords, experiments, saveProjectRecord } = useLabData();
  const [form, setForm] = useState(EMPTY_FORM);
  const [members, setMembers] = useState<LabMember[]>([]);
  const canManageProjects = activeMember?.role === "owner" || activeMember?.role === "admin" || activeMember?.role === "pi";

  useEffect(() => {
    if (!activeLab) return undefined;
    return subscribeLabMembers(activeLab.id, setMembers, () => setMembers([]));
  }, [activeLab]);

  const edit = (project: ProjectRecord) => {
    setForm({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      visibility: project.visibility ?? "lab",
      allowedMemberUids: project.allowedMemberUids ?? [],
      readOnlyShareEnabled: project.readOnlyShareEnabled ?? false,
      notebooks: project.notebooks.join(", "),
      folders: project.folders.join(", "),
      tags: project.tags.join(", "),
    });
  };

  const toggleMember = (uid: string) => {
    setForm((prev) => ({
      ...prev,
      allowedMemberUids: prev.allowedMemberUids.includes(uid)
        ? prev.allowedMemberUids.filter((item) => item !== uid)
        : [...prev.allowedMemberUids, uid],
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await saveProjectRecord({
      id: form.id || undefined,
      name: form.name,
      description: form.description,
      status: form.status,
      visibility: form.visibility,
      allowedMemberUids: form.allowedMemberUids,
      readOnlyShareEnabled: form.readOnlyShareEnabled,
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
              <div className="workbench-form-grid">
                <label className="modal-field">
                  <span>Visibility</span>
                  <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as ProjectVisibility })}>
                    <option value="lab">Lab-wide edit rules</option>
                    <option value="restricted">Restricted project</option>
                    <option value="read_only_link">Read-only share link</option>
                  </select>
                </label>
                <label className="project-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.readOnlyShareEnabled}
                    onChange={(e) => setForm({ ...form, readOnlyShareEnabled: e.target.checked, visibility: e.target.checked ? "read_only_link" : form.visibility })}
                  />
                  Read-only share token
                </label>
              </div>
              <div className="project-member-picker">
                <span>Project access list</span>
                {members.map((member) => (
                  <label key={member.uid}>
                    <input type="checkbox" checked={form.allowedMemberUids.includes(member.uid)} onChange={() => toggleMember(member.uid)} />
                    {member.displayName} ({member.role})
                  </label>
                ))}
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
                    <span className="workbench-pill">{project.visibility ?? "lab"}</span>
                    {(project.allowedMemberUids?.length ?? 0) > 0 && <span className="workbench-pill">{project.allowedMemberUids.length} project members</span>}
                    {project.readOnlyShareEnabled && <span className="workbench-pill primary">read-only share on</span>}
                    {project.notebooks.map((notebook) => <span key={notebook} className="workbench-pill">{notebook}</span>)}
                    {project.folders.map((folder) => <span key={folder} className="workbench-pill">{folder}</span>)}
                  </div>
                  <div className="workbench-actions">
                    {canManageProjects && <button className="btn-secondary" onClick={() => edit(project)}>Edit</button>}
                    {project.shareToken && (
                      <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/projects?projectId=${project.id}&share=${project.shareToken}`)}>
                        Copy Share Link
                      </button>
                    )}
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
