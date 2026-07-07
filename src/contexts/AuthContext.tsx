import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import type { Lab, LabMember, UserProfile } from "../data/accountTypes";
import { acceptLabInvite, ensureUserProfileAndLab } from "../services/accountService";
import { clearPendingInvite, getPendingInvite } from "../lib/pendingInvite";

interface AuthUser {
  uid: string;
  name: string;
  initials: string;
  department: string;
  email: string;
  photoURL: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  firebaseUser: User | null;
  profile: UserProfile | null;
  activeLab: Lab | null;
  activeMember: LabMember | null;
  isAuthenticated: boolean;
  isConfigured: boolean;
  isLoading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  login: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getInitials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function toAuthUser(profile: UserProfile, member: LabMember | null): AuthUser {
  const roleLabel = member?.role === "pi" || member?.role === "owner" ? "Principal Investigator" : member?.role === "viewer" ? "Viewer" : member?.role === "external" ? "External Collaborator" : "Researcher";
  return {
    uid: profile.uid,
    name: profile.displayName,
    initials: getInitials(profile.displayName, profile.email),
    department: roleLabel,
    email: profile.email,
    photoURL: profile.photoURL,
  };
}

function getAuthInstance() {
  if (!auth) {
    throw new Error("Firebase is not configured. Add your Firebase web app values to .env.local.");
  }

  return auth;
}

async function loadAccount(firebaseUser: User) {
  const invite = getPendingInvite();
  if (invite) {
    const account = await acceptLabInvite(firebaseUser, invite);
    clearPendingInvite();
    return account;
  }

  return ensureUserProfileAndLab(firebaseUser);
}

function friendlyAuthError(err: unknown) {
  const message = err instanceof Error ? err.message : "Unable to load account.";
  if (message.includes("invalid or has already been used")) {
    return "This invite link is invalid, has already been accepted, or was opened with the wrong email address.";
  }
  if (message.includes("Invite link was not found")) {
    return "This invite link was not found. Ask the lab owner to send a new invite.";
  }
  if (message.includes("Missing or insufficient permissions") || message.includes("permission-denied")) {
    return "Firebase blocked this invite request. Deploy the latest Firestore rules, then try again.";
  }
  return message;
}

function friendlyCredentialError(err: unknown) {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";

  if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
    return new Error("Email/password sign-in did not match. Check the password, use Google/Apple if that is how you created the account, or send a password reset link.");
  }

  if (code === "auth/email-already-in-use") {
    return new Error("An account already exists for that email. Use Sign in, continue with Google/Apple, or reset the password.");
  }

  if (code === "auth/weak-password") {
    return new Error("Use a password with at least 6 characters.");
  }

  if (code === "auth/invalid-email") {
    return new Error("Enter a valid email address.");
  }

  return err;
}

function publicAppUrl() {
  return (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim().replace(/\/+$/, "") || window.location.origin;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeLab, setActiveLab] = useState<Lab | null>(null);
  const [activeMember, setActiveMember] = useState<LabMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setIsLoading(false);
      return;
    }

    return onAuthStateChanged(auth, async (nextUser) => {
      setIsLoading(true);
      setFirebaseUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setActiveLab(null);
        setActiveMember(null);
        setIsLoading(false);
        return;
      }

      try {
        const account = await loadAccount(nextUser);
        setProfile(account.profile);
        setActiveLab(account.lab);
        setActiveMember(account.member);
        setAuthError(null);
      } catch (err) {
        setProfile(null);
        setActiveLab(null);
        setActiveMember(null);
        setAuthError(friendlyAuthError(err));
        await signOut(getAuthInstance());
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  const login = async (email: string, password: string) => {
    const firebaseAuth = getAuthInstance();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      throw new Error("Email is required");
    }

    try {
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
    } catch (err) {
      throw friendlyCredentialError(err);
    }
  };

  const createAccount = async (email: string, password: string) => {
    const firebaseAuth = getAuthInstance();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      throw new Error("Email is required");
    }

    try {
      await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
    } catch (err) {
      throw friendlyCredentialError(err);
    }
  };

  const resetPassword = async (email: string) => {
    const firebaseAuth = getAuthInstance();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      throw new Error("Enter your email first, then send a password reset link.");
    }

    try {
      await sendPasswordResetEmail(firebaseAuth, normalizedEmail, {
        url: `${publicAppUrl()}/login`,
      });
    } catch (err) {
      throw friendlyCredentialError(err);
    }
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(getAuthInstance(), provider);
  };

  const loginWithApple = async () => {
    const provider = new OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
    await signInWithPopup(getAuthInstance(), provider);
  };

  const logout = async () => {
    await signOut(getAuthInstance());
  };

  const user = profile ? toAuthUser(profile, activeMember) : null;

  const value = useMemo(
    () => ({
      user,
      firebaseUser,
      profile,
      activeLab,
      activeMember,
      isAuthenticated: !!user,
      isConfigured: isFirebaseConfigured,
      isLoading,
      authError,
      clearAuthError: () => setAuthError(null),
      login,
      createAccount,
      resetPassword,
      loginWithGoogle,
      loginWithApple,
      logout,
    }),
    [activeLab, activeMember, authError, firebaseUser, isLoading, profile, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
