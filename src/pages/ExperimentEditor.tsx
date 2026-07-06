import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./ExperimentEditor.css";
import { experimentDetails } from "../data/mockData";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIcon } from "../components/icons";
import type { Comment, ProtocolStepStatus } from "../data/types";

type PanelTab = "ai" | "comments" | "history";

export function ExperimentEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = id ? experimentDetails[id] : undefined;

  const [panelTab, setPanelTab] = useState<PanelTab>("ai");
  const [title, setTitle] = useState(detail?.name ?? "");
  const [steps, setSteps] = useState(detail?.protocol ?? []);
  const [comments, setComments] = useState<Comment[]>(detail?.comments ?? []);
  const [commentDraft, setCommentDraft] = useState("");

  if (!detail) {
    return (
      <div className="editor-not-found">
        <p>Experiment "{id}" was not found.</p>
        <button className="btn-primary" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const cycleStatus = (current: ProtocolStepStatus): ProtocolStepStatus => {
    if (current === "pending") return "in_progress";
    if (current === "in_progress") return "done";
    return "pending";
  };

  const toggleStep = (stepId: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? {
              ...s,
              status: cycleStatus(s.status),
            }
          : s,
      ),
    );
  };

  const submitComment = () => {
    if (!commentDraft.trim()) return;
    setComments((prev) => [
      ...prev,
      {
        id: `c${prev.length + 1}`,
        author: "You",
        initials: "SC",
        body: commentDraft.trim(),
        postedAt: "Just now",
      },
    ]);
    setCommentDraft("");
  };

  return (
    <>
      <div className="editor-topbar">
        <div className="editor-breadcrumb">
          <a onClick={() => navigate("/dashboard")}>Experiments</a>
          <span>›</span>
          <span>{detail.project}</span>
          <span>›</span>
          <span className="current">{detail.name}</span>
        </div>
        <div className="editor-topbar-actions">
          <StatusBadge status={detail.status} />
          <button className="btn-secondary">Share</button>
          <button className="btn-save">Save</button>
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          <input
            className="editor-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="editor-meta-row">
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Project</span>
              <span className="editor-meta-field-value">{detail.project}</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">Date</span>
              <span className="editor-meta-field-value">Jul 6, 2026</span>
            </div>
            <div className="editor-meta-field">
              <span className="editor-meta-field-label">ID</span>
              <span className="editor-meta-field-value mono">{detail.id}</span>
            </div>
            {detail.tags.map((tag) => (
              <span key={tag} className="editor-tag">
                {tag}
              </span>
            ))}
          </div>

          <div className="editor-toolbar">
            <button className="toolbar-btn bold-active">B</button>
            <button className="toolbar-btn italic">I</button>
            <button className="toolbar-btn underline">U</button>
            <div className="toolbar-divider" />
            <button className="toolbar-btn heading">H1</button>
            <button className="toolbar-btn heading">H2</button>
            <div className="toolbar-divider" />
            <button className="toolbar-btn">Table</button>
            <button className="toolbar-btn">Image</button>
            <button className="toolbar-btn">Protocol ▾</button>
            <div className="toolbar-divider" />
            <button className="toolbar-ai-btn">✦ AI Draft</button>
          </div>

          <div className="editor-card">
            <h3>Objective</h3>
            <p className="objective">{detail.objective}</p>
            <h3>Protocol Steps</h3>
            <div className="protocol-steps">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`protocol-step ${step.status}`}
                  onClick={() => toggleStep(step.id)}
                >
                  <div className="protocol-step-check">
                    {step.status === "done" && <CheckIcon />}
                  </div>
                  <span className="protocol-step-label">{step.label}</span>
                  {step.status === "done" && (
                    <span className="protocol-step-meta">
                      {step.completedBy} {step.completedAt}
                    </span>
                  )}
                  {step.status === "in_progress" && (
                    <span className="protocol-step-meta progress">In progress</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="editor-side-panel">
          <div className="side-panel-tabs">
            <button
              className={`side-panel-tab${panelTab === "ai" ? " active" : ""}`}
              onClick={() => setPanelTab("ai")}
            >
              AI Insights
            </button>
            <button
              className={`side-panel-tab${panelTab === "comments" ? " active" : ""}`}
              onClick={() => setPanelTab("comments")}
            >
              Comments ({comments.length})
            </button>
            <button
              className={`side-panel-tab${panelTab === "history" ? " active" : ""}`}
              onClick={() => setPanelTab("history")}
            >
              History
            </button>
          </div>

          <div className="side-panel-content">
            {panelTab === "ai" &&
              detail.aiInsights.map((insight) => (
                <div key={insight.id} className={`insight-card ${insight.kind}`}>
                  <div className="insight-card-title">{insight.title}</div>
                  <p className="insight-card-body">{insight.body}</p>
                  {insight.actionLabel && (
                    <button className="insight-card-action">{insight.actionLabel}</button>
                  )}
                </div>
              ))}

            {panelTab === "comments" &&
              comments.map((c) => (
                <div key={c.id} className="comment-card">
                  <div className="comment-card-header">
                    <div className="comment-avatar">{c.initials}</div>
                    <span className="comment-author">{c.author}</span>
                    <span className="comment-time">{c.postedAt}</span>
                  </div>
                  <p className="comment-body">{c.body}</p>
                </div>
              ))}

            {panelTab === "history" &&
              detail.history.map((h) => (
                <div key={h.id} className="history-entry">
                  <div className="history-action">
                    {h.actor} — {h.action}
                  </div>
                  <div className="history-meta">{h.timestamp}</div>
                </div>
              ))}
          </div>

          {panelTab !== "history" && (
            <div className="side-panel-footer">
              <input
                className="comment-input"
                placeholder="Add a comment…"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitComment();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
