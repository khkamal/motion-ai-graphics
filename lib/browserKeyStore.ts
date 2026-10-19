export type BrowserApiKeyStatus = "ACTIVE" | "COOLDOWN" | "INVALID";

export type BrowserApiKey = {
  id: string;
  label: string;
  masked: string;
  value: string;
  status: BrowserApiKeyStatus;
  failureCount: number;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
};

export type BrowserApiKeyUpdate = Pick<BrowserApiKey, "id" | "status" | "failureCount" | "cooldownUntil" | "lastUsedAt">;

const KEY_POOL_STORAGE_KEY = "motion-ai-studio:browser-key-pool:v1";
const ROTATION_CURSOR_STORAGE_KEY = "motion-ai-studio:browser-key-cursor:v1";
const STYLE_HISTORY_STORAGE_KEY = "motion-ai-studio:browser-style-history:v1";
export const KEY_POOL_UPDATED_EVENT = "motion-ai-studio:key-pool-updated";
const MAX_STYLE_HISTORY = 500;

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isBrowserApiKey(value: unknown): value is BrowserApiKey {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.label === "string" &&
    typeof item.masked === "string" && typeof item.value === "string" &&
    ["ACTIVE", "COOLDOWN", "INVALID"].includes(String(item.status)) &&
    typeof item.failureCount === "number" &&
    (item.cooldownUntil === null || typeof item.cooldownUntil === "string") &&
    (item.lastUsedAt === null || typeof item.lastUsedAt === "string");
}

function makeId(): string {
  const cryptoApi = window.crypto;
  if (typeof cryptoApi.randomUUID === "function") return `key_${cryptoApi.randomUUID().replace(/-/g, "")}`;
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return `key_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function readBrowserApiKeys(): BrowserApiKey[] {
  if (!hasBrowserStorage()) return [];
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(KEY_POOL_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isBrowserApiKey).slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function parseBrowserApiKeyInput(input: string): string[] {
  const values = input.split(/[,;\n\r]+/).map((value) => value.trim()).filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length > 10) throw new Error("A browser can store up to 10 Gemini API keys.");
  for (const value of unique) {
    if (value.length < 20 || value.length > 256 || /\s/.test(value)) {
      throw new Error("Each Gemini API key must be 20–256 characters with no spaces.");
    }
  }
  return unique;
}

export function saveBrowserApiKeys(values: string[]): BrowserApiKey[] {
  if (!hasBrowserStorage()) throw new Error("Browser storage is unavailable. Enable local storage and try again.");
  const keys = values.map((value, index): BrowserApiKey => ({
    id: makeId(),
    label: `Gemini key ${String(index + 1).padStart(2, "0")}`,
    masked: `•••• ${value.slice(-4)}`,
    value,
    status: "ACTIVE",
    failureCount: 0,
    cooldownUntil: null,
    lastUsedAt: null,
  }));
  window.localStorage.setItem(KEY_POOL_STORAGE_KEY, JSON.stringify(keys));
  window.localStorage.setItem(ROTATION_CURSOR_STORAGE_KEY, "0");
  window.dispatchEvent(new Event(KEY_POOL_UPDATED_EVENT));
  return keys;
}

export function writeBrowserApiKeys(keys: BrowserApiKey[]): void {
  if (!hasBrowserStorage()) throw new Error("Browser storage is unavailable. Enable local storage and try again.");
  window.localStorage.setItem(KEY_POOL_STORAGE_KEY, JSON.stringify(keys.slice(0, 10)));
  window.dispatchEvent(new Event(KEY_POOL_UPDATED_EVENT));
}

export function clearBrowserApiKeys(): void {
  if (!hasBrowserStorage()) throw new Error("Browser storage is unavailable. Enable local storage and try again.");
  window.localStorage.removeItem(KEY_POOL_STORAGE_KEY);
  window.localStorage.setItem(ROTATION_CURSOR_STORAGE_KEY, "0");
  window.dispatchEvent(new Event(KEY_POOL_UPDATED_EVENT));
}

export function readBrowserRotationCursor(): number {
  if (!hasBrowserStorage()) return 0;
  const value = Number(window.localStorage.getItem(ROTATION_CURSOR_STORAGE_KEY) ?? "0");
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function writeBrowserRotationCursor(value: number): void {
  if (!hasBrowserStorage()) return;
  const cursor = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  window.localStorage.setItem(ROTATION_CURSOR_STORAGE_KEY, String(cursor));
}

export function applyBrowserApiKeyUpdates(updates: BrowserApiKeyUpdate[]): BrowserApiKey[] {
  const updateById = new Map(updates.map((update) => [update.id, update]));
  const keys = readBrowserApiKeys().map((key) => {
    const update = updateById.get(key.id);
    return update ? { ...key, ...update } : key;
  });
  writeBrowserApiKeys(keys);
  return keys;
}

export function readRecentStyleSignatures(): string[] {
  if (!hasBrowserStorage()) return [];
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STYLE_HISTORY_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === "string" && value.length <= 128).slice(0, MAX_STYLE_HISTORY)
      : [];
  } catch {
    return [];
  }
}

export function rememberStyleSignature(signature: string): void {
  if (!hasBrowserStorage() || !signature) return;
  const signatures = readRecentStyleSignatures();
  window.localStorage.setItem(STYLE_HISTORY_STORAGE_KEY, JSON.stringify([signature, ...signatures.filter((item) => item !== signature)].slice(0, MAX_STYLE_HISTORY)));
}
