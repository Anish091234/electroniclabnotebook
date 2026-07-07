import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import "./Login.css";
import { LogoMark } from "../components/icons";
import { useAuth } from "../contexts/AuthContext";
import { getPendingInvite, rememberInviteFromSearch, type PendingInvite } from "../lib/pendingInvite";

export function Login() {
  const { authError, clearAuthError, createAccount, isConfigured, login, loginWithApple, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(() => getPendingInvite());
  const isInviteLogin = Boolean(pendingInvite);
  const [authMode, setAuthMode] = useState<"signin" | "create">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = isInviteLogin ? "/dashboard" : (location.state as { from?: Location } | null)?.from?.pathname ?? "/dashboard";

  useEffect(() => {
    setPendingInvite(rememberInviteFromSearch(location.search) ?? getPendingInvite());
  }, [location.search]);

  const runLogin = async (callback: () => Promise<void>) => {
    setError(null);
    clearAuthError();
    setIsSubmitting(true);
    try {
      await callback();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await runLogin(() => (authMode === "signin" ? login(email, password) : createAccount(email, password)));
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="login-brand-mark">
            <LogoMark size={18} />
          </div>
          <span className="login-brand-name">LabOS</span>
        </div>

        <div className="login-heading">
          <h1>{isInviteLogin ? "Accept lab invite" : authMode === "signin" ? "Welcome back" : "Create account"}</h1>
          <p>
            {isInviteLogin
              ? "Sign in or create an account with the invited email to join the lab"
              : authMode === "signin"
                ? "Sign in to your existing lab account"
                : "Create your LabOS account and starter lab"}
          </p>
        </div>

        {!isConfigured && (
          <div className="login-error">
            Firebase is not configured yet. Copy .env.example to .env.local and add your Firebase web app values.
          </div>
        )}

        {(error || authError) && <div className="login-error">{error || authError}</div>}
        {isInviteLogin && (
          <div className="login-info">
            Invite link captured. Sign in or create an account with the invited email address to join the lab.
          </div>
        )}

        <div className="social-login-grid">
          <button
            className="social-login-btn"
            type="button"
            disabled={!isConfigured || isSubmitting}
            onClick={() => runLogin(loginWithGoogle)}
          >
            Continue with Google
          </button>
          <button
            className="social-login-btn"
            type="button"
            disabled={!isConfigured || isSubmitting}
            onClick={() => runLogin(loginWithApple)}
          >
            Continue with Apple
          </button>
        </div>

        <div className="login-divider">
          <span>Email</span>
        </div>

        <div className="login-mode-toggle" aria-label="Email authentication mode">
          <button
            type="button"
            className={authMode === "signin" ? "active" : ""}
            onClick={() => {
              setAuthMode("signin");
              setError(null);
              clearAuthError();
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={authMode === "create" ? "active" : ""}
            onClick={() => {
              setAuthMode("create");
              setError(null);
              clearAuthError();
            }}
          >
            Create account
          </button>
        </div>

        <div className="login-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@lab.io"
            autoComplete="email"
            required
          />
        </div>

        <div className="login-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
            minLength={6}
          />
        </div>

        <button className="login-submit" type="submit" disabled={!isConfigured || isSubmitting}>
          {isSubmitting ? (authMode === "signin" ? "Signing in..." : "Creating...") : authMode === "signin" ? "Sign in with Email" : "Create Account"}
        </button>

        <p className="login-hint">
          {isInviteLogin
            ? "Use the email address that received the invite. New invitees should choose Create account."
            : authMode === "signin"
              ? "Use this for an account you already created."
              : "New accounts create a starter lab unless you are accepting an invite."}
        </p>
      </form>
    </div>
  );
}
