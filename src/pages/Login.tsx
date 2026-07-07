import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import "./Login.css";
import { LogoMark } from "../components/icons";
import { useAuth } from "../contexts/AuthContext";

export function Login() {
  const { isConfigured, login, loginWithApple, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const inviteParams = new URLSearchParams(location.search);
  const isInviteLogin = Boolean(inviteParams.get("labId") && inviteParams.get("invite") && inviteParams.get("inviteId"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = isInviteLogin ? "/dashboard" : (location.state as { from?: Location } | null)?.from?.pathname ?? "/dashboard";

  const runLogin = async (callback: () => Promise<void>) => {
    setError(null);
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
    await runLogin(() => login(email, password));
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
          <h1>{isInviteLogin ? "Accept lab invite" : "Welcome back"}</h1>
          <p>{isInviteLogin ? "Sign in with the invited email to join the lab" : "Sign in or create your lab account"}</p>
        </div>

        {!isConfigured && (
          <div className="login-error">
            Firebase is not configured yet. Copy .env.example to .env.local and add your Firebase web app values.
          </div>
        )}

        {error && <div className="login-error">{error}</div>}
        {isInviteLogin && <div className="login-info">After sign-in, LabOS will add this account to the invited lab.</div>}

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
          {isSubmitting ? "Signing in..." : "Continue with Email"}
        </button>

        <p className="login-hint">
          {isInviteLogin ? "Use the email address that received the invite." : "First email/password sign-in creates an account and a starter lab."}
        </p>
      </form>
    </div>
  );
}
