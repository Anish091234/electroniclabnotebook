import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import "./AppLayout.css";

export function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-layout-main">
        <Outlet />
      </div>
    </div>
  );
}
