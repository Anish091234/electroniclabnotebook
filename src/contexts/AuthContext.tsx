import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import type { Lab, LabMember, UserProfile } from "../data/accountTypes";
import { acceptLabInvite, ensureUserProfileAndLab } from "../services/accountService";

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
  login: (email: string, password: string) => Promise<void>;
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

function pendingInviteFromLocation() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const labId = params.get("labId");
  const inviteId = params.get("inviteId");
  const token = params.get("invite");

  return labId && inviteId && token ? { labId, inviteId, token } : null;
}

async function loadAccount(firebaseUser: User) {
  const invite = pendingInviteFromLocation();
  if (invite) {
    return acceptLabInvite(firebaseUser, invite);
  }

  return ensureUserProfileAndLab(firebaseUser);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeLab, setActiveLab] = useState<Lab | null>(null);
  const [activeMember, setActiveMember] = useState<LabMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
      const code = typeof err === "object" && err && "code" in err ? String(err.code) : "";
      if (code !== "auth/user-not-found" && code !== "auth/invalid-credential") {
        throw err;
      }

      await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
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
      login,
      loginWithGoogle,
      loginWithApple,
      logout,
    }),
    [activeLab, activeMember, firebaseUser, isLoading, profile, user],
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
