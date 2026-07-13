import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GoogleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  setPersistence,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../lib/firebase";
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
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  resendVerification: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  loginWithGoogle: (rememberMe?: boolean) => Promise<void>;
  loginWithApple: (rememberMe?: boolean) => Promise<void>;
  reauthenticateForSignature: (password?: string) => Promise<void>;
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
  if (!firebaseUser.emailVerified) {
    throw new Error("email-verification-required");
  }

  const invite = getPendingInvite();
  if (invite) {
    const account = await acceptLabInvite(invite);
    clearPendingInvite();
    return account;
  }

  return ensureUserProfileAndLab(firebaseUser);
}

function friendlyAuthError(err: unknown) {
  const message = err instanceof Error ? err.message : "Unable to load account.";
  if (message.includes("email-verification-required") || message.includes("Verify the invited email address")) {
    return "Verify your email address before accessing LabOS. Check your inbox, then sign in again.";
  }
  if (message.includes("expired, was canceled, or has already been used") || message.includes("invite is invalid")) {
    return "This invite link is invalid, expired, canceled, or has already been accepted. Ask the lab owner to issue a new invite.";
  }
  if (message.includes("Invite link was not found")) {
    return "This invite link was not found. Ask the lab owner to send a new invite.";
  }
  if (message.includes("different email address")) {
    return "This invite was issued to a different email address. Sign in with the invited address or ask the lab owner to reissue it.";
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

function isVerificationRequiredError(err: unknown) {
  return err instanceof Error && err.message.includes("email-verification-required");
}

function publicAppUrl() {
  return (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim().replace(/\/+$/, "") || window.location.origin;
}

async function setSessionPersistence(rememberMe: boolean) {
  await setPersistence(getAuthInstance(), rememberMe ? browserLocalPersistence : browserSessionPersistence);
}

function verificationContinueUrl() {
  // Verification emails must not become a second carrier for an invite token.
  // The original invite stays only in the recipient's current browser session
  // (or can be reopened from the original invitation message).
  return `${publicAppUrl()}/login`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeLab, setActiveLab] = useState<Lab | null>(null);
  const [activeMember, setActiveMember] = useState<LabMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const firebaseUserUid = firebaseUser?.uid ?? null;
  const profileUid = profile?.uid ?? null;
  const activeLabId = activeLab?.id ?? null;

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
        // Account creation and resend verification need a brief authenticated
        // session to send the email. The initiating action signs out after the
        // send completes; an unverified account never receives a LabOS profile
        // or membership while this observer is waiting.
        if (!isVerificationRequiredError(err)) {
          await signOut(getAuthInstance());
        }
      } finally {
        setIsLoading(false);
      }
    });
  }, []);

  // Membership is authorization state, not just profile data. Keep the
  // current member document live so a trusted ownership transfer (or an
  // access-status change) takes effect in the interface without a reload.
  useEffect(() => {
    if (!firebaseUserUid || !profileUid || profileUid !== firebaseUserUid || !activeLabId || !db) {
      return undefined;
    }

    const revokeLabAccess = (message: string) => {
      setActiveMember(null);
      setAuthError(message);
      // `onAuthStateChanged` clears the remaining account state. Keep the
      // access-revoked message so the login screen can explain the redirect.
      void signOut(getAuthInstance()).catch(() => {
        setAuthError(message);
      });
    };

    return onSnapshot(
      doc(db, "labs", activeLabId, "members", firebaseUserUid),
      (snapshot) => {
        if (!snapshot.exists()) {
          revokeLabAccess("Your membership in the active lab is no longer available.");
          return;
        }

        const member = snapshot.data() as LabMember;
        if (member.uid !== firebaseUserUid || member.status !== "active") {
          revokeLabAccess("Your access to the active lab has been revoked. Contact the lab owner if you believe this is an error.");
          return;
        }
        setActiveMember(member);
      },
      (error) => {
        // Once a membership is disabled or removed, Firestore rules no longer
        // permit the member document to be read. Treat that terminal error as
        // access revocation rather than leaving a stale authenticated shell.
        if (error.code === "permission-denied") {
          revokeLabAccess("Your access to the active lab has been revoked. Contact the lab owner if you believe this is an error.");
          return;
        }
        setAuthError((current) => current ?? "Unable to refresh your lab membership. Reload LabOS and contact the lab owner if this continues.");
      },
    );
  }, [activeLabId, firebaseUserUid, profileUid]);

  const login = async (email: string, password: string, rememberMe = false) => {
    const firebaseAuth = getAuthInstance();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      throw new Error("Email is required");
    }

    try {
      await setSessionPersistence(rememberMe);
      const credential = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      if (!credential.user.emailVerified) {
        await signOut(firebaseAuth);
        throw new Error("email-verification-required");
      }
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
      await setSessionPersistence(false);
      const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      await sendEmailVerification(credential.user, { url: verificationContinueUrl() });
    } catch (err) {
      throw friendlyCredentialError(err);
    } finally {
      if (firebaseAuth.currentUser && !firebaseAuth.currentUser.emailVerified) {
        await signOut(firebaseAuth);
      }
    }
  };

  const resendVerification = async (email: string, password: string) => {
    const firebaseAuth = getAuthInstance();
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      throw new Error("Enter your email and password to resend the verification email.");
    }

    try {
      await setSessionPersistence(false);
      const credential = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      if (credential.user.emailVerified) {
        await signOut(firebaseAuth);
        throw new Error("This email address is already verified. Sign in normally to continue.");
      }
      await sendEmailVerification(credential.user, { url: verificationContinueUrl() });
    } catch (err) {
      throw friendlyCredentialError(err);
    } finally {
      if (firebaseAuth.currentUser && !firebaseAuth.currentUser.emailVerified) {
        await signOut(firebaseAuth);
      }
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

  const loginWithGoogle = async (rememberMe = false) => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await setSessionPersistence(rememberMe);
    const firebaseAuth = getAuthInstance();
    const credential = await signInWithPopup(firebaseAuth, provider);
    if (!credential.user.emailVerified) {
      await signOut(firebaseAuth);
      throw new Error("email-verification-required");
    }
  };

  const loginWithApple = async (rememberMe = false) => {
    const provider = new OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
    await setSessionPersistence(rememberMe);
    const firebaseAuth = getAuthInstance();
    const credential = await signInWithPopup(firebaseAuth, provider);
    if (!credential.user.emailVerified) {
      await signOut(firebaseAuth);
      throw new Error("email-verification-required");
    }
  };

  const reauthenticateForSignature = async (password?: string) => {
    const firebaseAuth = getAuthInstance();
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) throw new Error("Sign in again before creating an electronic signature.");

    const providerIds = currentUser.providerData.map((provider) => provider.providerId);
    if (providerIds.includes("password")) {
      if (!currentUser.email || !password) {
        throw new Error("Enter your account password to confirm this electronic signature.");
      }
      await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
    } else if (providerIds.includes("google.com")) {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await reauthenticateWithPopup(currentUser, provider);
    } else if (providerIds.includes("apple.com")) {
      const provider = new OAuthProvider("apple.com");
      await reauthenticateWithPopup(currentUser, provider);
    } else {
      throw new Error("This sign-in method cannot confirm an electronic signature yet. Sign out, then sign in again before signing.");
    }

    await currentUser.getIdToken(true);
  };

  const logout = async () => {
    await signOut(getAuthInstance());
  };

  const user = profile ? toAuthUser(profile, activeMember) : null;
  const isAuthenticated = !!user && activeMember?.status === "active";

  const value = useMemo(
    () => ({
      user,
      firebaseUser,
      profile,
      activeLab,
      activeMember,
      isAuthenticated,
      isConfigured: isFirebaseConfigured,
      isLoading,
      authError,
      clearAuthError: () => setAuthError(null),
      login,
      createAccount,
      resendVerification,
      resetPassword,
      loginWithGoogle,
      loginWithApple,
      reauthenticateForSignature,
      logout,
    }),
    [activeLab, activeMember, authError, firebaseUser, isAuthenticated, isLoading, profile, user],
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
