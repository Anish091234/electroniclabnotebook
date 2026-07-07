import "./Dashboard.css";
import "./CompetitivePages.css";
import { useAuth } from "../contexts/AuthContext";
import { useLabData } from "../contexts/LabDataContext";

export function Notifications() {
  const { user } = useAuth();
  const { notifications, markNotificationRead } = useLabData();
  const unread = notifications.filter((notification) => user && !notification.readBy.includes(user.uid));

  return (
    <>
      <div className="topbar">
        <h1>Notifications</h1>
      </div>
      <div className="workbench-content">
        <div className="score-list">
          <div className="score-card"><span>Unread</span><strong>{unread.length}</strong><small>Needs attention</small></div>
          <div className="score-card"><span>High Priority</span><strong>{notifications.filter((n) => n.priority === "high").length}</strong><small>Review, due, or low stock</small></div>
          <div className="score-card"><span>Review</span><strong>{notifications.filter((n) => n.kind === "review").length}</strong><small>PI workflow</small></div>
          <div className="score-card"><span>Tasks</span><strong>{notifications.filter((n) => n.kind === "task").length}</strong><small>Collaboration</small></div>
        </div>

        <div className="workbench-list">
          {notifications.length === 0 && <div className="empty-row">No notifications yet.</div>}
          {notifications.map((notification) => {
            const isUnread = user && !notification.readBy.includes(user.uid);
            return (
              <article key={notification.id} className="workbench-card">
                <div className="workbench-card-row">
                  <div>
                    <h2>{notification.title}</h2>
                    <p>{notification.body}</p>
                  </div>
                  <span className={`workbench-pill${isUnread ? " primary" : ""}`}>{isUnread ? "Unread" : "Read"}</span>
                </div>
                <div className="workbench-pill-row">
                  <span className="workbench-pill">{notification.kind}</span>
                  <span className="workbench-pill">{notification.priority}</span>
                  <span className="workbench-pill">{new Date(notification.createdAt).toLocaleString()}</span>
                </div>
                {isUnread && (
                  <div className="workbench-actions">
                    <button className="btn-secondary" onClick={() => markNotificationRead(notification.id)}>Mark Read</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
