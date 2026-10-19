import { decryptApiKey } from "@/lib/keyVault";
import {
  coolDownApiKey,
  getWorkspaceApiKeys,
  markApiKeySuccessful,
  markApiKeyUsed,
  nextWorkspaceKeyIndex,
  rejectApiKey,
  resetWorkspaceKeyIndex,
} from "@/lib/database";

const RATE_LIMIT_COOLDOWN_MS = 60_000;

export class ApiKeyPoolEmptyError extends Error {
  constructor() {
    super("No Gemini API keys are configured for this workspace.");
    this.name = "ApiKeyPoolEmptyError";
  }
}

export class ApiKeyPoolExhaustedError extends Error {
  readonly retryAt: Date | null;

  constructor(message: string, retryAt: Date | null = null) {
    super(message);
    this.name = "ApiKeyPoolExhaustedError";
    this.retryAt = retryAt;
  }
}

function isRateLimit(status: number, body: string): boolean {
  return status === 429 || /resource[_ ]?exhausted|quota exceeded|rate.?limit/i.test(body);
}

function isKeyRejected(status: number, body: string): boolean {
  return status === 401 || (status === 403 && /api key|permission|invalid|unauthorized/i.test(body));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425;
}

export async function requestWithRotatingKey(
  workspaceId: string,
  requestFactory: (apiKey: string, signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const storedKeys = getWorkspaceApiKeys(workspaceId);
  if (storedKeys.length === 0) throw new ApiKeyPoolEmptyError();
  const allKeys = storedKeys.filter((key) => key.status === "ACTIVE");
  if (allKeys.length === 0) throw new ApiKeyPoolExhaustedError("All stored Gemini keys were rejected and need to be replaced.");

  const now = new Date();
  const readyKeys = allKeys.filter((key) => !key.cooldownUntil || key.cooldownUntil <= now);
  if (readyKeys.length === 0) {
    const retryAt = allKeys
      .map((key) => key.cooldownUntil)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    throw new ApiKeyPoolExhaustedError("All configured Gemini keys are cooling down after rate limits.", retryAt);
  }

  const start = nextWorkspaceKeyIndex(workspaceId, readyKeys.length);
  let lastFailure = "Gemini request failed.";
  let lastRetryAt: Date | null = null;

  for (let attempt = 0; attempt < readyKeys.length; attempt += 1) {
    const index = (start + attempt) % readyKeys.length;
    const record = readyKeys[index];
    let apiKey: string;
    try {
      apiKey = decryptApiKey(record.encryptedKey);
    } catch {
      rejectApiKey(record.id);
      lastFailure = "A stored Gemini key could not be decrypted. Check API_KEY_ENCRYPTION_KEY.";
      continue;
    }

    markApiKeyUsed(record.id);
    let response: Response;
    try {
      response = await requestFactory(apiKey, AbortSignal.timeout(30_000));
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "Gemini network request failed.";
      if (attempt < readyKeys.length - 1) continue;
      throw new ApiKeyPoolExhaustedError(lastFailure);
    }

    if (response.ok) {
      markApiKeySuccessful(record.id);
      return response;
    }

    const body = await response.clone().text().catch(() => "");
    if (isRateLimit(response.status, body)) {
      const cooldownUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS);
      coolDownApiKey(record.id, cooldownUntil);
      lastRetryAt = cooldownUntil;
      lastFailure = "Gemini rate limit reached for the current key.";
      continue;
    }

    if (isKeyRejected(response.status, body)) {
      rejectApiKey(record.id);
      lastFailure = "A Gemini key was rejected. Check its permissions or replace it.";
      continue;
    }

    if (isRetryableStatus(response.status) && attempt < readyKeys.length - 1) {
      lastFailure = `Gemini returned a temporary ${response.status} error.`;
      continue;
    }

    return response;
  }

  throw new ApiKeyPoolExhaustedError(lastFailure, lastRetryAt);
}

export async function resetKeyRotation(workspaceId: string): Promise<void> {
  resetWorkspaceKeyIndex(workspaceId);
}
