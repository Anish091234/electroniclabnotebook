import "./Dashboard.css";
import "./CompetitivePages.css";
import { TEMPLATE_LIBRARY } from "../data/templateLibrary";
import { useLabData } from "../contexts/LabDataContext";

export function TemplateLibrary() {
  const { saveProtocolTemplate } = useLabData();

  const installTemplate = async (templateId: string) => {
    const template = TEMPLATE_LIBRARY.find((item) => item.id === templateId);
    if (!template) return;
    await saveProtocolTemplate({
      name: template.name,
      description: template.description,
      status: "draft",
      steps: template.steps,
    });
  };

  return (
    <>
      <div className="topbar">
        <h1>Template Library</h1>
      </div>
      <div className="workbench-content">
        <div className="workbench-list">
          {TEMPLATE_LIBRARY.map((template) => (
            <article key={template.id} className="workbench-card">
              <div className="workbench-card-row">
                <div>
                  <h2>{template.name}</h2>
                  <p>{template.description}</p>
                </div>
                <span className="workbench-pill primary">{template.category}</span>
              </div>
              <ol>
                {template.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className="workbench-pill-row">
                {template.tags.map((tag) => <span key={tag} className="workbench-pill">{tag}</span>)}
              </div>
              <div className="workbench-actions">
                <button className="btn-primary" onClick={() => installTemplate(template.id)}>Install as Draft</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
