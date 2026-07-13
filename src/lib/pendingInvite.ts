const PENDING_INVITE_KEY = "labos.pendingInvite";

export interface PendingInvite {
  labId: string;
  inviteId: string;
  token: string;
}

export function inviteFromSearch(search: string): PendingInvite | null {
  return inviteFromParams(search);
}

export function inviteFromFragment(hash: string): PendingInvite | null {
  return inviteFromParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

function inviteFromParams(value: string): PendingInvite | null {
  const params = new URLSearchParams(value);
  const labId = params.get("labId");
  const inviteId = params.get("inviteId");
  const token = params.get("invite");

  return labId && inviteId && token ? { labId, inviteId, token } : null;
}

export function rememberInvite(invite: PendingInvite | null) {
  if (!invite || typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(invite));
}

export function rememberInviteFromLocation(search: string, hash: string) {
  // New links keep the bearer token in the fragment, which browsers do not
  // transmit to hosting/access logs. Keep query support only for older links.
  const invite = inviteFromFragment(hash) ?? inviteFromSearch(search);
  rememberInvite(invite);
  return invite;
}

export function getPendingInvite() {
  if (typeof window === "undefined") return null;

  const fromUrl = inviteFromFragment(window.location.hash) ?? inviteFromSearch(window.location.search);
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
