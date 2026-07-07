import { useState, type FormEvent } from "react";
import "./Dashboard.css";
import "./CompetitivePages.css";
import type { SampleKind, SampleRecord, SampleStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";

const EMPTY_FORM = {
  id: "",
  name: "",
  kind: "sample" as SampleKind,
  registryId: "",
  projectId: "",
  location: "",
  status: "available" as SampleStatus,
  parentSampleId: "",
  source: "",
  metadata: "",
};

const SAMPLE_KIND_OPTIONS: SampleKind[] = ["sample", "plasmid", "cell_line", "antibody", "compound", "organism", "dataset", "aliquot"];

export function Registry() {
  const { sampleRecords, projectRecords, saveSampleRecord } = useLabData();
  const [form, setForm] = useState(EMPTY_FORM);

  const edit = (sample: SampleRecord) => {
    setForm({
      id: sample.id,
      name: sample.name,
      kind: sample.kind,
      registryId: sample.registryId,
      projectId: sample.projectId ?? "",
      location: sample.location,
      status: sample.status,
      parentSampleId: sample.parentSampleId ?? "",
      source: sample.source,
      metadata: sample.metadata,
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await saveSampleRecord({
      id: form.id || undefined,
      name: form.name,
      kind: form.kind,
      registryId: form.registryId,
      projectId: form.projectId || null,
      location: form.location,
      status: form.status,
      parentSampleId: form.parentSampleId || null,
      source: form.source,
      metadata: form.metadata,
    });
    setForm(EMPTY_FORM);
  };

  const parentName = (id?: string | null) => sampleRecords.find((sample) => sample.id === id)?.name ?? "No parent";

  return (
    <>
      <div className="topbar">
        <h1>Registry</h1>
      </div>
      <div className="workbench-content">
        <div className="workbench-grid">
          <form className="workbench-panel" onSubmit={submit}>
            <h2>{form.id ? "Edit Registry Record" : "New Registry Record"}</h2>
            <label className="modal-field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="workbench-form-grid">
              <label className="modal-field">
                <span>Kind</span>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SampleKind })}>
                  {SAMPLE_KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{kind.replace("_", " ")}</option>)}
                </select>
              </label>
              <label className="modal-field"><span>Registry ID</span><input value={form.registryId} onChange={(e) => setForm({ ...form, registryId: e.target.value })} placeholder="AUTO if blank" /></label>
            </div>
            <label className="modal-field">
              <span>Project</span>
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">No project</option>
                {projectRecords.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <div className="workbench-form-grid">
              <label className="modal-field"><span>Location</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
              <label className="modal-field">
                <span>Status</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SampleStatus })}>
                  <option value="available">Available</option>
                  <option value="in_use">In use</option>
                  <option value="consumed">Consumed</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
            <label className="modal-field">
              <span>Parent / Lineage</span>
              <select value={form.parentSampleId} onChange={(e) => setForm({ ...form, parentSampleId: e.target.value })}>
                <option value="">No parent</option>
                {sampleRecords.filter((sample) => sample.id !== form.id).map((sample) => <option key={sample.id} value={sample.id}>{sample.name}</option>)}
              </select>
            </label>
            <label className="modal-field"><span>Source</span><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label>
            <label className="modal-field"><span>Metadata</span><textarea value={form.metadata} onChange={(e) => setForm({ ...form, metadata: e.target.value })} rows={4} placeholder="Passage, sequence, concentration, hazard, QC..." /></label>
            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setForm(EMPTY_FORM)}>Reset</button>
              <button className="btn-primary" type="submit">Save Record</button>
            </div>
          </form>

          <div className="workbench-list">
            {sampleRecords.length === 0 && <div className="empty-row">No registry records yet.</div>}
            {sampleRecords.map((sample) => (
              <article key={sample.id} className="workbench-card">
                <div className="workbench-card-row">
                  <div>
                    <h2>{sample.name}</h2>
                    <p>{sample.metadata || "No metadata recorded."}</p>
                  </div>
                  <span className="workbench-pill primary">{sample.kind.replace("_", " ")}</span>
                </div>
                <div className="workbench-pill-row">
                  <span className="workbench-pill">{sample.registryId}</span>
                  <span className="workbench-pill">{sample.status.replace("_", " ")}</span>
                  <span className="workbench-pill">{sample.location || "No location"}</span>
                  <span className="workbench-pill">Parent: {parentName(sample.parentSampleId)}</span>
                </div>
                <div className="workbench-actions">
                  <button className="btn-secondary" onClick={() => edit(sample)}>Edit</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
