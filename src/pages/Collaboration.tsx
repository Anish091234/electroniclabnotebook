import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";
import "./CompetitivePages.css";
import { useLabData } from "../contexts/LabDataContext";

const EMPTY_TASK = {
  title: "",
  description: "",
  assigneeName: "",
  experimentId: "",
  dueDate: "",
};

export function Collaboration() {
  const navigate = useNavigate();
  const { experimentDetails, collaborationTasks, auditEvents, createTask, updateTaskStatus } = useLabData();
  const [task, setTask] = useState(EMPTY_TASK);

  const reviewQueue = Object.values(experimentDetails).filter((experiment) => experiment.status === "review" || experiment.reviewStatus === "requested");
  const openTasks = collaborationTasks.filter((item) => item.status !== "done");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await createTask({
      title: task.title,
      description: task.description,
      assigneeName: task.assigneeName || null,
      experimentId: task.experimentId || null,
      dueDate: task.dueDate || null,
    });
    setTask(EMPTY_TASK);
  };

  return (
    <>
      <div className="topbar">
        <h1>Collaboration</h1>
      </div>
      <div className="workbench-content">
        <div className="score-list">
          <div className="score-card"><span>Review Queue</span><strong>{reviewQueue.length}</strong><small>Awaiting PI action</small></div>
          <div className="score-card"><span>Open Tasks</span><strong>{openTasks.length}</strong><small>Assigned follow-ups</small></div>
          <div className="score-card"><span>Completed</span><strong>{collaborationTasks.filter((item) => item.status === "done").length}</strong><small>Closed tasks</small></div>
          <div className="score-card"><span>Activity</span><strong>{auditEvents.length}</strong><small>Audit events</small></div>
        </div>

        <div className="workbench-grid">
          <form className="workbench-panel" onSubmit={submit}>
            <h2>Assign Task</h2>
            <label className="modal-field"><span>Title</span><input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} required /></label>
            <label className="modal-field"><span>Description</span><textarea value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} rows={3} /></label>
            <label className="modal-field"><span>Assignee</span><input value={task.assigneeName} onChange={(e) => setTask({ ...task, assigneeName: e.target.value })} placeholder="Name or @mention" /></label>
            <label className="modal-field">
              <span>Experiment</span>
              <select value={task.experimentId} onChange={(e) => setTask({ ...task, experimentId: e.target.value })}>
                <option value="">No experiment</option>
                {Object.values(experimentDetails).map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}
              </select>
            </label>
            <label className="modal-field"><span>Due Date</span><input type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} /></label>
            <div className="experiment-modal-actions">
              <button className="btn-primary" type="submit">Create Task</button>
            </div>
          </form>

          <div className="workbench-list">
            <section className="workbench-card">
              <h2>PI Review Queue</h2>
              {reviewQueue.length === 0 && <p>No experiments are waiting for review.</p>}
              {reviewQueue.map((experiment) => (
                <div key={experiment.id} className="workbench-card-row">
                  <div>
                    <h3>{experiment.name}</h3>
                    <p>{experiment.reviewComment || experiment.objective || "No review note."}</p>
                  </div>
                  <button className="btn-secondary" onClick={() => navigate(`/experiments/${experiment.id}`)}>Open</button>
                </div>
              ))}
            </section>

            {collaborationTasks.map((item) => (
              <article key={item.id} className="workbench-card">
                <div className="workbench-card-row">
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.description || "No description."}</p>
                  </div>
                  <span className="workbench-pill primary">{item.status.replace("_", " ")}</span>
                </div>
                <div className="workbench-pill-row">
                  <span className="workbench-pill">{item.assigneeName || "Unassigned"}</span>
                  <span className="workbench-pill">{item.dueDate || "No due date"}</span>
                </div>
                <div className="workbench-actions">
                  <button className="btn-secondary" onClick={() => updateTaskStatus(item.id, "in_progress")}>Start</button>
                  <button className="btn-secondary" onClick={() => updateTaskStatus(item.id, "done")}>Done</button>
                  {item.experimentId && <button className="btn-secondary" onClick={() => navigate(`/experiments/${item.experimentId}`)}>Experiment</button>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
