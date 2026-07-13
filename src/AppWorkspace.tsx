import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { LabDataProvider } from "./contexts/LabDataContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";

const Login = lazy(async () => ({ default: (await import("./pages/Login")).Login }));
const Dashboard = lazy(async () => ({ default: (await import("./pages/Dashboard")).Dashboard }));
const Search = lazy(async () => ({ default: (await import("./pages/Search")).Search }));
const ExperimentEditor = lazy(async () => ({ default: (await import("./pages/ExperimentEditor")).ExperimentEditor }));
const ExperimentReport = lazy(async () => ({ default: (await import("./pages/ExperimentReport")).ExperimentReport }));
const Protocols = lazy(async () => ({ default: (await import("./pages/Protocols")).Protocols }));
const Inventory = lazy(async () => ({ default: (await import("./pages/Inventory")).Inventory }));
const Registry = lazy(async () => ({ default: (await import("./pages/Registry")).Registry }));
const Projects = lazy(async () => ({ default: (await import("./pages/Projects")).Projects }));
const Analytics = lazy(async () => ({ default: (await import("./pages/Analytics")).Analytics }));
const ComplianceCenter = lazy(async () => ({ default: (await import("./pages/ComplianceCenter")).ComplianceCenter }));
const Notifications = lazy(async () => ({ default: (await import("./pages/Notifications")).Notifications }));
const TemplateLibrary = lazy(async () => ({ default: (await import("./pages/TemplateLibrary")).TemplateLibrary }));
const Integrations = lazy(async () => ({ default: (await import("./pages/Integrations")).Integrations }));
const Collaboration = lazy(async () => ({ default: (await import("./pages/Collaboration")).Collaboration }));
const Team = lazy(async () => ({ default: (await import("./pages/Team")).Team }));
const AuditLog = lazy(async () => ({ default: (await import("./pages/AuditLog")).AuditLog }));

/**
 * Everything that needs Firebase is isolated behind this lazy route boundary.
 * The public landing page can therefore paint before the Firebase/Auth bundle
 * is fetched, which materially improves first-visit acquisition performance.
 */
export default function AppWorkspace() {
  return (
    <AuthProvider>
      <LabDataProvider>
        <Suspense fallback={<div className="app-route-loading" role="status">Loading LabOS...</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/search" element={<Search />} />
                <Route path="/experiments/:id" element={<ExperimentEditor />} />
                <Route path="/experiments/:id/report" element={<ExperimentReport />} />
                <Route path="/protocols" element={<Protocols />} />
                <Route path="/protocols/:id" element={<Navigate to="/protocols" replace />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/registry" element={<Registry />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/compliance" element={<ComplianceCenter />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/templates" element={<TemplateLibrary />} />
                <Route path="/integrations" element={<Integrations />} />
                <Route path="/collaboration" element={<Collaboration />} />
                <Route path="/team" element={<Team />} />
                <Route path="/audit-log" element={<AuditLog />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </LabDataProvider>
    </AuthProvider>
  );
}
