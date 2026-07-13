import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import "./Login.css";
import { LogoMark } from "../components/icons";
import { useAuth } from "../contexts/AuthContext";
import { getPendingInvite, rememberInviteFromLocation, type PendingInvite } from "../lib/pendingInvite";

export function Login() {
  const { authError, clearAuthError, createAccount, isConfigured, login, loginWithApple, loginWithGoogle, resendVerification, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(() => getPendingInvite());
  const isInviteLogin = Boolean(pendingInvite);
  const [authMode, setAuthMode] = useState<"signin" | "create">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const from = isInviteLogin ? "/dashboard" : (location.state as { from?: Location } | null)?.from?.pathname ?? "/dashboard";
  const errorMessage = error || authError;
  const passwordsDoNotMatch = authMode === "create" && Boolean(confirmPassword) && password !== confirmPassword;
  const isBusy = isSubmitting || isResettingPassword || isResendingVerification;

  useEffect(() => {
    const captured = rememberInviteFromLocation(location.search, location.hash);
    setPendingInvite(captured ?? getPendingInvite());

    if (captured) {
      const params = new URLSearchParams(location.search);
      params.delete("invite");
      params.delete("inviteId");
      params.delete("labId");
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "", hash: "" }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    document.title = isInviteLogin
      ? "Accept lab invite | LabOS"
      : authMode === "signin"
        ? "Sign in | LabOS"
        : "Create account | LabOS";
  }, [authMode, isInviteLogin]);

  const runLogin = async (callback: () => Promise<void>) => {
    setError(null);
    setNotice(null);
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
    const normalizedEmail = email.trim();

    if (authMode === "signin") {
      await runLogin(() => login(normalizedEmail, password, rememberMe));
      return;
    }

    if (password !== confirmPassword) {
      setNotice(null);
      clearAuthError();
      setError("Passwords do not match.");
      return;
    }

    setError(null);
    setNotice(null);
    clearAuthError();
    setIsSubmitting(true);
    try {
      await createAccount(normalizedEmail, password);
      setNotice("Verification email sent. Open it to verify your account, then return here and sign in.");
      setAuthMode("signin");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    const normalizedEmail = email.trim();
    setError(null);
    setNotice(null);
    clearAuthError();

    if (!normalizedEmail) {
      setError("Enter your email address before requesting a password reset.");
      return;
    }

    setIsResettingPassword(true);

    try {
      await resetPassword(normalizedEmail);
      setNotice("Password reset email sent. Check your inbox, then come back here to sign in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send password reset email");
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleResendVerification = async () => {
    const normalizedEmail = email.trim();
    setError(null);
    setNotice(null);
    clearAuthError();

    if (!normalizedEmail || !password) {
      setError("Enter the email address and password for the unverified account first.");
      return;
    }

    setIsResendingVerification(true);

    try {
      await resendVerification(normalizedEmail, password);
      setNotice("Verification email resent. Open it to verify your account, then sign in again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend verification email");
    } finally {
      setIsResendingVerification(false);
    }
  };

  const verificationRequired = (errorMessage || "").includes("Verify your email address");

  const clearMessages = () => {
    setError(null);
    setNotice(null);
    clearAuthError();
  };

  return (
    <main className="login-page" aria-labelledby="login-title">
      <a className="login-home-link" href="/">Back to LabOS home</a>
      <form className="login-card" onSubmit={handleSubmit} aria-busy={isBusy}>
        <div className="login-brand">
          <div className="login-brand-mark" aria-hidden="true">
            <LogoMark size={18} />
          </div>
          <span className="login-brand-name">LabOS</span>
        </div>

        <div className="login-heading">
          <h1 id="login-title">{isInviteLogin ? "Accept lab invite" : authMode === "signin" ? "Welcome back" : "Create account"}</h1>
          <p>
            {isInviteLogin
              ? "Sign in or create an account with the invited email, then verify it to join the lab"
              : authMode === "signin"
                ? "Sign in to your existing lab account"
                : "Create and verify your LabOS account before starting a lab"}
          </p>
        </div>

        {!isConfigured && (
          <div className="login-error" role="alert" aria-live="assertive">
            Firebase is not configured yet. Copy .env.example to .env.local and add your Firebase web app values.
          </div>
        )}

        {errorMessage && <div id="login-message" className="login-error" role="alert" aria-live="assertive" aria-atomic="true">{errorMessage}</div>}
        {notice && <div className="login-info" role="status" aria-live="polite" aria-atomic="true">{notice}</div>}
        {verificationRequired && (
          <button
            className="login-secondary-action"
            type="button"
            disabled={!isConfigured || isBusy}
            onClick={handleResendVerification}
          >
            {isResendingVerification ? "Resending verification..." : "Resend verification email"}
          </button>
        )}
        {isInviteLogin && (
          <div className="login-info" role="status" aria-live="polite">
            Invite link captured. Sign in or create an account with the invited email address, then verify it to join the lab.
          </div>
        )}

        <div className="social-login-grid">
          <button
            className="social-login-btn"
            type="button"
            disabled={!isConfigured || isBusy}
            onClick={() => runLogin(() => loginWithGoogle(rememberMe))}
          >
            Continue with Google
          </button>
          <button
            className="social-login-btn"
            type="button"
            disabled={!isConfigured || isBusy}
            onClick={() => runLogin(() => loginWithApple(rememberMe))}
          >
            Continue with Apple
          </button>
        </div>

        <div className="login-divider">
          <span>Email</span>
        </div>

        <div className="login-mode-toggle" role="group" aria-label="Email authentication mode">
          <button
            type="button"
            className={authMode === "signin" ? "active" : ""}
            aria-pressed={authMode === "signin"}
            disabled={isBusy}
            onClick={() => {
              setAuthMode("signin");
              setConfirmPassword("");
              clearMessages();
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={authMode === "create" ? "active" : ""}
            aria-pressed={authMode === "create"}
            disabled={isBusy}
            onClick={() => {
              setAuthMode("create");
              setConfirmPassword("");
              clearMessages();
            }}
          >
            Create account
          </button>
        </div>

        <div className="login-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@lab.io"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            spellCheck={false}
            disabled={isBusy}
            required
          />
        </div>

        <div className="login-field">
          <div className="login-label-row">
            <label htmlFor="password">Password</label>
            {authMode === "signin" && (
            <button type="button" disabled={!isConfigured || isBusy} onClick={handleResetPassword}>
                {isResettingPassword ? "Sending..." : "Forgot password?"}
              </button>
            )}
          </div>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={authMode === "signin" ? "current-password" : "new-password"}
            aria-describedby={authMode === "create" ? "password-requirements" : undefined}
            aria-invalid={passwordsDoNotMatch || undefined}
            disabled={isBusy}
            required
            minLength={6}
          />
          {authMode === "create" && <p id="password-requirements" className="login-field-help">Use at least 6 characters.</p>}
        </div>

        {authMode === "create" && (
          <div className="login-field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              name="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              aria-invalid={passwordsDoNotMatch || undefined}
              aria-describedby={passwordsDoNotMatch ? "password-match-error" : undefined}
              disabled={isBusy}
              required
              minLength={6}
            />
            {passwordsDoNotMatch && <p id="password-match-error" className="login-field-error">Passwords do not match.</p>}
          </div>
        )}

        <label className="login-remember">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} disabled={isBusy} />
          <span>Keep me signed in on this device</span>
        </label>

        <button className="login-submit" type="submit" disabled={!isConfigured || isBusy}>
          {isSubmitting ? (authMode === "signin" ? "Signing in..." : "Creating...") : authMode === "signin" ? "Sign in with Email" : "Create Account"}
        </button>

        <p className="login-hint">
          {isInviteLogin
            ? "Use the email address that received the invite. New invitees should create and verify an account first."
            : authMode === "signin"
              ? "Use this for an account you already created."
              : "After verification, new accounts create a starter lab unless you are accepting an invite."}
        </p>
        <p className="login-shared-device">On a shared lab computer, leave "Keep me signed in" unchecked.</p>
      </form>
    </main>
  );
}
