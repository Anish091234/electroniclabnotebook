const PENDING_INVITE_KEY = "labos.pendingInvite";

export interface PendingInvite {
  labId: string;
  inviteId: string;
  token: string;
}

export function inviteFromSearch(search: string): PendingInvite | null {
  const params = new URLSearchParams(search);
  const labId = params.get("labId");
  const inviteId = params.get("inviteId");
  const token = params.get("invite");

  return labId && inviteId && token ? { labId, inviteId, token } : null;
}

export function rememberInvite(invite: PendingInvite | null) {
  if (!invite || typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(invite));
}

export function rememberInviteFromSearch(search: string) {
  const invite = inviteFromSearch(search);
  rememberInvite(invite);
  return invite;
}

export function getPendingInvite() {
  if (typeof window === "undefined") return null;

  const fromUrl = inviteFromSearch(window.location.search);
  if (fromUrl) {
    rememberInvite(fromUrl);
    return fromUrl;
  }

  const stored = window.sessionStorage.getItem(PENDING_INVITE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as PendingInvite;
    return parsed.labId && parsed.inviteId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_INVITE_KEY);
}
