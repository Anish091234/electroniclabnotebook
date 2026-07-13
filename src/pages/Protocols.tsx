import { useState, type FormEvent } from "react";
import "./Dashboard.css";
import "./Protocols.css";
import type { ProtocolTemplate, ProtocolTemplateStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  version: 1,
  status: "draft" as ProtocolTemplateStatus,
  steps: "Define objective\nPrepare materials\nRun procedure\nRecord observations",
};

export function Protocols() {
  const { protocolTemplates, saveProtocolTemplate, deleteProtocolTemplate } = useLabData();
  const { activeMember } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canManageProtocols = activeMember?.role === "owner" || activeMember?.role === "admin" || activeMember?.role === "pi";

  const edit = (template: ProtocolTemplate) => {
    setFormError(null);
    setForm({
      id: template.id,
      name: template.name,
      description: template.description,
      version: template.version + 1,
      status: template.status,
      steps: template.steps.join("\n"),
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!form.steps.split("\n").some((step) => step.trim())) {
      setFormError("Add at least one non-empty protocol step before saving.");
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      await saveProtocolTemplate({
        id: form.id || undefined,
        name: form.name,
        description: form.description,
        version: form.version,
        status: form.status,
        steps: form.steps.split("\n"),
      });
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save this protocol template.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <h1>Protocols</h1>
      </div>
      <div className={`protocols-content${canManageProtocols ? "" : " read-only"}`}>
        {canManageProtocols ? (
          <form className="protocol-editor-card" onSubmit={submit}>
            <h2>{form.id ? "Edit Protocol Template" : "New Protocol Template"}</h2>
            {formError && <div className="modal-error" role="alert">{formError}</div>}
            <label className="modal-field">
              <span>Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="modal-field">
              <span>Description</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </label>
            <div className="protocol-form-grid">
              <label className="modal-field">
                <span>Version</span>
                <input type="number" min={1} value={form.version} onChange={(e) => setForm({ ...form, version: Number(e.target.value) })} />
              </label>
              <label className="modal-field">
                <span>Status</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProtocolTemplateStatus })}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="retired">Retired</option>
                </select>
              </label>
            </div>
            <label className="modal-field">
              <span>Steps</span>
              <textarea value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} rows={8} required />
            </label>
            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" disabled={isSaving} onClick={() => { setForm(EMPTY_FORM); setFormError(null); }}>Reset</button>
              <button className="btn-primary" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Template"}</button>
            </div>
          </form>
        ) : (
          <div className="protocol-readonly-note">Protocol templates are read-only for your current lab role.</div>
        )}

        <div className="protocol-list">
          {protocolTemplates.length === 0 && <div className="empty-row">No protocol templates yet.</div>}
          {protocolTemplates.map((template) => (
            <article key={template.id} className="protocol-template-card">
              <div>
                <h2>{template.name}</h2>
                <p>{template.description || "No description."}</p>
                <div className="protocol-template-meta">
                  <span>v{template.version}</span>
                  <span>{template.status}</span>
                  <span>{template.steps.length} steps</span>
                </div>
              </div>
              <ol>
                {template.steps.map((step, index) => <li key={`${template.id}-${index}`}>{step}</li>)}
              </ol>
              {canManageProtocols && (
                <div className="protocol-card-actions">
                  <button className="btn-secondary" onClick={() => edit(template)}>Edit / Version</button>
                  <button className="btn-secondary" onClick={() => deleteProtocolTemplate(template.id)}>Delete</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
