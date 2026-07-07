import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { LabDataProvider } from "./contexts/LabDataContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Search } from "./pages/Search";
import { ExperimentEditor } from "./pages/ExperimentEditor";
import { ExperimentReport } from "./pages/ExperimentReport";
import { Protocols } from "./pages/Protocols";
import { ProtocolDetail } from "./pages/ProtocolDetail";
import { Inventory } from "./pages/Inventory";
import { Registry } from "./pages/Registry";
import { Projects } from "./pages/Projects";
import { Analytics } from "./pages/Analytics";
import { ComplianceCenter } from "./pages/ComplianceCenter";
import { Notifications } from "./pages/Notifications";
import { TemplateLibrary } from "./pages/TemplateLibrary";
import { Integrations } from "./pages/Integrations";
import { Collaboration } from "./pages/Collaboration";
import { Team } from "./pages/Team";
import { AuditLog } from "./pages/AuditLog";

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <LabDataProvider>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="search" element={<Search />} />
                  <Route path="experiments/:id" element={<ExperimentEditor />} />
                  <Route path="experiments/:id/report" element={<ExperimentReport />} />
                  <Route path="protocols" element={<Protocols />} />
                  <Route path="protocols/:id" element={<ProtocolDetail />} />
                  <Route path="inventory" element={<Inventory />} />
                  <Route path="registry" element={<Registry />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="compliance" element={<ComplianceCenter />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="templates" element={<TemplateLibrary />} />
                  <Route path="integrations" element={<Integrations />} />
                  <Route path="collaboration" element={<Collaboration />} />
                  <Route path="team" element={<Team />} />
                  <Route path="audit-log" element={<AuditLog />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Route>
              </Route>
            </Routes>
          </LabDataProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
