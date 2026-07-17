import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import "./Dashboard.css";
import "./Protocols.css";
import type { ProtocolTemplate, ProtocolTemplateStatus } from "../data/types";
import { useLabData } from "../contexts/LabDataContext";
import { useAuth } from "../contexts/AuthContext";
import { importProtocolFile } from "../lib/protocolImport";
import { exportSopDocx, sanitizeSopHtml, sopHtmlToSteps, stepsToSopHtml } from "../lib/sopDocument";

const EMPTY_FORM = {
  id: "",
  name: "Untitled SOP",
  description: "",
  version: 1,
  status: "draft" as ProtocolTemplateStatus,
  documentHtml: "<h1>Standard Operating Procedure</h1><p>Start writing your SOP here.</p>",
  locked: false,
};

export function Protocols() {
  const { protocolTemplates, saveProtocolTemplate, deleteProtocolTemplate } = useLabData();
  const { activeMember } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const canManageProtocols = activeMember?.role === "owner" || activeMember?.role === "admin" || activeMember?.role === "pi";

  const updateDocument = (html: string) => setForm((current) => ({ ...current, documentHtml: sanitizeSopHtml(html) }));

  const edit = (template: ProtocolTemplate) => {
    setFormError(null);
    setImportMessage(null);
    setForm({
      id: template.id,
      name: template.name,
      description: template.description,
      version: template.version + 1,
      status: template.status,
      documentHtml: template.documentHtml || stepsToSopHtml(template.steps),
      locked: Boolean(template.locked),
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const documentHtml = sanitizeSopHtml(form.documentHtml);
    const steps = sopHtmlToSteps(documentHtml, form.name);
    if (steps.length === 0) {
      setFormError("Add some SOP content before saving.");
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
        steps,
        documentHtml,
        locked: form.locked,
      });
      setImportMessage(form.locked ? "SOP saved and locked." : "SOP saved. You can keep editing it or lock it when it is final.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save this SOP.");
    } finally {
      setIsSaving(false);
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isImporting) return;
    setFormError(null);
    setImportMessage(null);
    setIsImporting(true);
    try {
      const imported = await importProtocolFile(file);
      setForm({
        id: "",
        name: imported.name,
        description: imported.description,
        version: 1,
        status: "draft",
        documentHtml: imported.documentHtml,
        locked: false,
      });
      setImportMessage(`Imported ${file.name}. Its headings, paragraphs, and lists are ready to edit.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "We could not read that document.");
    } finally {
      setIsImporting(false);
    }
  };

  const format = (command: string, value?: string) => {
    if (form.locked) return;
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) updateDocument(editorRef.current.innerHTML);
  };

  return (
    <>
      <div className="topbar"><h1>Protocols</h1></div>
      <div className={`protocols-content sop-workspace${canManageProtocols ? "" : " read-only"}`}>
        {canManageProtocols ? (
          <form className="protocol-editor-card sop-document-card" onSubmit={submit}>
            <div className="sop-editor-heading">
              <div><h2>{form.id ? "Edit SOP" : "New SOP"}</h2><p>Draft, review, lock, and export your lab procedures.</p></div>
              <span className={`sop-lock-badge${form.locked ? " locked" : ""}`}>{form.locked ? "Locked" : "Editable"}</span>
            </div>
            {formError && <div className="modal-error" role="alert">{formError}</div>}
            {importMessage && <div className="protocol-import-success" role="status">{importMessage}</div>}
            <input ref={fileInputRef} className="protocol-file-input" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf" onChange={importFile} />
            <div className="sop-actions-bar">
              <button type="button" className="btn-secondary" disabled={isImporting || form.locked} onClick={() => fileInputRef.current?.click()}>{isImporting ? "Importing..." : "Import Word or PDF"}</button>
              <button type="button" className="btn-secondary" onClick={() => exportSopDocx(form.name, form.documentHtml)}>Export .docx</button>
              <button type="button" className="btn-secondary" onClick={() => setForm((current) => ({ ...current, locked: !current.locked }))}>{form.locked ? "Unlock editing" : "Lock SOP"}</button>
            </div>
            <label className="modal-field"><span>SOP title</span><input value={form.name} disabled={form.locked} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="modal-field"><span>Summary</span><textarea value={form.description} disabled={form.locked} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></label>
            <div className="protocol-form-grid">
              <label className="modal-field"><span>Version</span><input type="number" min={1} disabled={form.locked} value={form.version} onChange={(e) => setForm({ ...form, version: Number(e.target.value) })} /></label>
              <label className="modal-field"><span>Status</span><select disabled={form.locked} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProtocolTemplateStatus })}><option value="draft">Draft</option><option value="active">Active</option><option value="retired">Retired</option></select></label>
            </div>
            <div className={`sop-editor-shell${form.locked ? " locked" : ""}`}>
              <div className="sop-toolbar" aria-label="Text formatting">
                <button type="button" aria-label="Bold" disabled={form.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => format("bold")}><strong>B</strong></button>
                <button type="button" aria-label="Italic" disabled={form.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => format("italic")}><em>I</em></button>
                <button type="button" aria-label="Heading" disabled={form.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => format("formatBlock", "h2")}>Heading</button>
                <button type="button" aria-label="Paragraph" disabled={form.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => format("formatBlock", "p")}>Text</button>
                <button type="button" aria-label="Bulleted list" disabled={form.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => format("insertUnorderedList")}>Bullets</button>
                <button type="button" aria-label="Numbered list" disabled={form.locked} onMouseDown={(e) => e.preventDefault()} onClick={() => format("insertOrderedList")}>Numbered</button>
              </div>
              {form.locked && <div className="sop-locked-note">This SOP is locked. Unlock editing to make changes.</div>}
              <div ref={editorRef} className="sop-rich-editor" contentEditable={!form.locked} suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: form.documentHtml }} onInput={(e) => updateDocument(e.currentTarget.innerHTML)} />
            </div>
            <div className="experiment-modal-actions">
              <button type="button" className="btn-secondary" disabled={isSaving} onClick={() => { setForm(EMPTY_FORM); setFormError(null); setImportMessage(null); }}>New blank SOP</button>
              <button className="btn-primary" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : form.locked ? "Save locked SOP" : "Save SOP"}</button>
            </div>
          </form>
        ) : <div className="protocol-readonly-note">SOPs are read-only for your current lab role.</div>}
        <div className="protocol-list">
          {protocolTemplates.length === 0 && <div className="empty-row">No SOPs yet. Import a Word document or start a blank one.</div>}
          {protocolTemplates.map((template) => (
            <article key={template.id} className="protocol-template-card sop-card">
              <div><h2>{template.name}</h2><p>{template.description || "No summary."}</p><div className="protocol-template-meta"><span>v{template.version}</span><span>{template.status}</span><span>{template.locked ? "locked" : "editable"}</span></div></div>
              <div className="sop-card-preview" dangerouslySetInnerHTML={{ __html: template.documentHtml || stepsToSopHtml(template.steps) }} />
              {canManageProtocols && <div className="protocol-card-actions"><button className="btn-secondary" onClick={() => edit(template)}>Open SOP</button><button className="btn-secondary" onClick={() => deleteProtocolTemplate(template.id)}>Delete</button></div>}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
