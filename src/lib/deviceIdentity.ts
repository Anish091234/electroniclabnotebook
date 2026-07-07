export interface ClientDeviceIdentity {
  deviceId: string;
  sessionId: string;
  deviceLabel: string;
  browser: string;
  platform: string;
  timezone: string;
  userAgent: string;
}

const DEVICE_STORAGE_KEY = "labos.deviceId";
const SESSION_STORAGE_KEY = "labos.sessionId";

function createStableId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function detectBrowser(userAgent: string) {
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome/")) return "Chrome";
  if (userAgent.includes("Firefox/")) return "Firefox";
  if (userAgent.includes("Safari/")) return "Safari";
  return "Browser";
}

function readOrCreateStorageId(storage: Storage, key: string, prefix: string) {
  const existing = storage.getItem(key);
  if (existing) return existing;

  const next = createStableId(prefix);
  storage.setItem(key, next);
  return next;
}

export function getClientDeviceIdentity(): ClientDeviceIdentity {
  if (typeof window === "undefined") {
    return {
      deviceId: "device-server-render",
      sessionId: "session-server-render",
      deviceLabel: "Server render",
      browser: "Server",
      platform: "Server",
      timezone: "UTC",
      userAgent: "server",
    };
  }

  const userAgent = navigator.userAgent || "Unknown user agent";
  const navWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = navWithUserAgentData.userAgentData?.platform || navigator.platform || "Unknown platform";
  const browser = detectBrowser(userAgent);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  const deviceId = readOrCreateStorageId(window.localStorage, DEVICE_STORAGE_KEY, "device");
  const sessionId = readOrCreateStorageId(window.sessionStorage, SESSION_STORAGE_KEY, "session");

  return {
    deviceId,
    sessionId,
    deviceLabel: `${browser} on ${platform}`,
    browser,
    platform,
    timezone,
    userAgent: userAgent.slice(0, 180),
  };
}
