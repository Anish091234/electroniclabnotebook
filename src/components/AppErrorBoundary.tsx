import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error reporting is added with the production monitoring integration.
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-boundary" role="alert">
          <div>
            <h1>LabOS needs to reload</h1>
            <p>Your data has not been changed by this error. Reload the app and try again.</p>
            <button type="button" onClick={() => window.location.reload()}>Reload LabOS</button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
