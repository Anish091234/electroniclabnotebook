import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentUser } from "../data/mockData";

interface AuthUser {
  name: string;
  initials: string;
  department: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = "labos.auth";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setUser(currentUser);
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, _password: string) => {
    if (!email.trim()) {
      throw new Error("Email is required");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    localStorage.setItem(STORAGE_KEY, "true");
    setUser(currentUser);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, isLoading, login, logout }),
    [user, isLoading],
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
