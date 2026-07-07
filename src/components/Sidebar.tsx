import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Sidebar.css";
import {
  LogoMark,
  DashboardIcon,
  AlertIcon,
  ExperimentsIcon,
  ProtocolsIcon,
  InventoryIcon,
  AnalyticsIcon,
  TeamIcon,
  AuditLogIcon,
  SparkleIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
} from "./icons";
import { useAuth } from "../contexts/AuthContext";
import { useLabData } from "../contexts/LabDataContext";
import { useTheme } from "../contexts/ThemeContext";

interface NavItem {
  label: string;
  path: string;
  icon: (color: string) => ReactNode;
  isActive: (pathname: string) => boolean;
  badge?: string;
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: (color) => <DashboardIcon color={color} />,
    isActive: (p) => p === "/dashboard" || p === "/",
  },
  {
    label: "Search",
    path: "/search",
    icon: (color) => <SearchIcon color={color} />,
    isActive: (p) => p.startsWith("/search"),
  },
  {
    label: "Experiments",
    path: "/dashboard",
    icon: (color) => <ExperimentsIcon color={color} />,
    isActive: (p) => p.startsWith("/experiments"),
  },
  {
    label: "Protocols",
    path: "/protocols",
    icon: (color) => <ProtocolsIcon color={color} />,
    isActive: (p) => p.startsWith("/protocols"),
  },
  {
    label: "Inventory",
    path: "/inventory",
    icon: (color) => <InventoryIcon color={color} />,
    isActive: (p) => p.startsWith("/inventory"),
  },
  {
    label: "Registry",
    path: "/registry",
    icon: (color) => <InventoryIcon color={color} />,
    isActive: (p) => p.startsWith("/registry"),
  },
  {
    label: "Projects",
    path: "/projects",
    icon: (color) => <DashboardIcon color={color} />,
    isActive: (p) => p.startsWith("/projects"),
  },
  {
    label: "Analytics",
    path: "/analytics",
    icon: (color) => <AnalyticsIcon color={color} />,
    isActive: (p) => p.startsWith("/analytics"),
  },
  {
    label: "Compliance",
    path: "/compliance",
    icon: (color) => <AuditLogIcon color={color} />,
    isActive: (p) => p.startsWith("/compliance"),
  },
  {
    label: "Notifications",
    path: "/notifications",
    icon: (color) => <AlertIcon color={color} size={14} />,
    isActive: (p) => p.startsWith("/notifications"),
  },
  {
    label: "Templates",
    path: "/templates",
    icon: (color) => <ProtocolsIcon color={color} />,
    isActive: (p) => p.startsWith("/templates"),
  },
  {
    label: "Integrations",
    path: "/integrations",
    icon: (color) => <AnalyticsIcon color={color} />,
    isActive: (p) => p.startsWith("/integrations"),
  },
  {
    label: "Collaboration",
    path: "/collaboration",
    icon: (color) => <TeamIcon color={color} />,
    isActive: (p) => p.startsWith("/collaboration"),
  },
  {
    label: "Team",
    path: "/team",
    icon: (color) => <TeamIcon color={color} />,
    isActive: (p) => p.startsWith("/team"),
  },
  {
    label: "Audit Log",
    path: "/audit-log",
    icon: (color) => <AuditLogIcon color={color} />,
    isActive: (p) => p.startsWith("/audit-log"),
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { experiments } = useLabData();
  const { isDark, toggleTheme } = useTheme();

  const experimentMatch = location.pathname.match(/^\/experiments\/([^/]+)/);
  const aiTitle = "AI Assistant";
  const aiBody = experimentMatch ? `Monitoring ${experimentMatch[1]}` : "Anomaly in EXP-0142";
  const aiPill = experimentMatch ? "active" : "3 new";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <LogoMark />
        </div>
        <span className="sidebar-brand-name">LabOS</span>
        <button
          className="sidebar-theme-toggle"
          type="button"
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={toggleTheme}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const active = item.isActive(location.pathname);
          return (
            <button
              key={item.label}
              className={`sidebar-nav-item${active ? " active" : ""}`}
              onClick={() => navigate(item.path)}
            >
              {item.icon(active ? "var(--color-primary)" : "var(--color-text-faint)")}
              <span>{item.label}</span>
              {(item.badge || item.label === "Experiments") && (
                <span className="sidebar-nav-item-badge">
                  {item.label === "Experiments" ? experiments.length : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer-spacer">
        <div className="sidebar-ai-card">
          <div className="sidebar-ai-card-header">
            <SparkleIcon />
            <span className="sidebar-ai-card-title">{aiTitle}</span>
            <span className="sidebar-ai-card-pill">{aiPill}</span>
          </div>
          <p className="sidebar-ai-card-body">{aiBody}</p>
        </div>
      </div>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">{user?.initials}</div>
        <div>
          <div className="sidebar-user-name">{user?.name}</div>
          <div className="sidebar-user-dept">{user?.department}</div>
        </div>
        <button className="sidebar-logout" onClick={logout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
