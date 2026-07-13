import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const Landing = lazy(async () => ({ default: (await import("./pages/Landing")).Landing }));
const AppWorkspace = lazy(() => import("./AppWorkspace"));

function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <Suspense fallback={<main className="app-route-loading" role="status" aria-live="polite">Loading LabOS...</main>}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="*" element={<AppWorkspace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}

export default App;
