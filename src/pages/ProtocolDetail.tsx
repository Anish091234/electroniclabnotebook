import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentEditor.css";
import "./ProtocolsList.css";
import "./ProtocolDetail.css";
import { protocolDetails } from "../data/mockData";

type PanelTab = "insight" | "used_in" | "history";

export function ProtocolDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = id ? protocolDetails[id] : undefined;

  const [panelTab, setPanelTab] = useState<PanelTab>(detail?.aiInsight ? "insight" : "used_in");

  if (!detail) {
    return (
      <div className="editor-not-found">
        <p>Protocol "{id}" was not found.</p>
        <button className="btn-primary" onClick={() => navigate("/protocols")}>
          Back to Protocols
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="editor-topbar">
        <div className="editor-breadcrumb">
          <a onClick={() => navigate("/protocols")}>Protocols</a>
          <span>›</span>
          <span>{detail.category}</span>
          <span>›</span>
          <span className="current">{detail.name}</span>
        </div>
        <div className="editor-topbar-actions">
          <span className="version-badge">{detail.version}</span>
          <button className="btn-secondary">Edit</button>
          <button className="btn-save">Use in New Experiment</button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          <h1 className="protocol-detail-title">{detail.name}</h1>

          <div className="editor-meta-row">
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Category</span>
              <span className="editor-meta-field-value">{detail.category}</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">ID</span>
              <span className="editor-meta-field-value mono">{detail.id}</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Last Updated</span>
              <span className="editor-meta-field-value">{detail.lastUpdated}</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Used</span>
              <span className="editor-meta-field-value">{detail.usedCount} runs</span>
            </div>
            {detail.successRate != null && (
              <span className={`success-rate ${detail.successRate >= 95 ? "high" : "mid"}`}>
                {detail.successRate}% success
              </span>
            )}
          </div>

          <div className="editor-card">
            <h3>Description</h3>
            <p className="protocol-description">{detail.description}</p>
            <h3>Steps</h3>
            <div className="protocol-steps">
              {detail.steps.map((step) => (
                <div key={step.id} className="protocol-step-template">
                  <div className="protocol-step-number">{step.order}</div>
                  <div style={{ flex: 1 }}>
                    <div className="protocol-step-template-title">{step.title}</div>
                    <p className="protocol-step-template-desc">{step.description}</p>
                    <div className="protocol-step-template-meta">
                      {step.duration && step.duration !== "—" && (
                        <span className="protocol-step-duration">⏱ {step.duration}</span>
                      )}
                      {step.reagents?.map((r) => (
                        <span key={r} className="protocol-reagent-chip">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="editor-side-panel">
          <div className="side-panel-tabs">
            {detail.aiInsight && (
              <button
                className={`side-panel-tab${panelTab === "insight" ? " active" : ""}`}
                onClick={() => setPanelTab("insight")}
              >
                AI Insight
              </button>
            )}
            <button
              className={`side-panel-tab${panelTab === "used_in" ? " active" : ""}`}
              onClick={() => setPanelTab("used_in")}
            >
              Used In ({detail.usedIn.length})
            </button>
            <button
              className={`side-panel-tab${panelTab === "history" ? " active" : ""}`}
              onClick={() => setPanelTab("history")}
            >
              Version History
            </button>
          </div>

          <div className="side-panel-content">
            {panelTab === "insight" && detail.aiInsight && (
              <div className="insight-card alert">
                <div className="insight-card-title">{detail.aiInsight.title}</div>
                <p className="insight-card-body">{detail.aiInsight.body}</p>
              </div>
            )}

            {panelTab === "used_in" &&
              (detail.usedIn.length === 0 ? (
                <p className="protocol-step-template-desc">Not used in any experiments yet.</p>
              ) : (
                detail.usedIn.map((u) => (
                  <div
                    key={u.experimentId}
                    className="usage-entry"
                    onClick={() => navigate(`/experiments/${u.experimentId}`)}
                  >
                    <div className="usage-entry-name">{u.experimentName}</div>
                    <div className="usage-entry-meta">
                      {u.experimentId} · {u.usedAt}
                    </div>
                  </div>
                ))
              ))}

            {panelTab === "history" &&
              detail.versionHistory.map((v) => (
                <div key={v.id} className="version-entry">
                  <div className="version-entry-header">
                    <span className="version-badge">{v.version}</span>
                    <span className="version-entry-meta">
                      {v.author} · {v.date}
                    </span>
                  </div>
                  <p className="version-entry-summary">{v.changeSummary}</p>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
