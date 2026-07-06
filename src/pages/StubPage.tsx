import type { ReactNode } from "react";
import "./Dashboard.css";
import "./StubPage.css";

interface StubPageProps {
  title: string;
  description: string;
  icon: ReactNode;
}

export function StubPage({ title, description, icon }: StubPageProps) {
  return (
    <>
      <div className="topbar">
        <h1>{title}</h1>
      </div>
      <div className="stub-page-body">
        <div className="stub-page-card">
          <div className="stub-page-icon">{icon}</div>
          <h2 className="stub-page-title">{title}</h2>
          <p className="stub-page-desc">{description}</p>
          <span className="stub-page-badge">Coming soon</span>
        </div>
      </div>
    </>
  );
}
