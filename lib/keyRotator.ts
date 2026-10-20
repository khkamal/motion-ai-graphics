import type { BrowserApiKey } from "@/lib/browserKeyStore";

const RATE_LIMIT_COOLDOWN_MS = 60_000;

export class ApiKeyPoolExhaustedError extends Error {
  readonly keys: BrowserApiKey[];
  readonly rotationCursor: number;
  readonly retryAt: Date | null;

  constructor(
    message: string,
    keys: BrowserApiKey[],
    rotationCursor: number,
    retryAt: Date | null = null,
  ) {
    super(message);
    this.name = "ApiKeyPoolExhaustedError";
    this.keys = keys;
    this.rotationCursor = rotationCursor;
    this.retryAt = retryAt;
  }
}

export type RotatingKeyResult = {
  response: Response;
  keys: BrowserApiKey[];
  rotationCursor: number;
  usedKeyId: string;
};

export type KeyRotationOptions = {
  timeoutMs?: number;
  retryNetworkErrors?: boolean;
  isKeyRejected?: (status: number, body: string) => boolean;
  isRetryableStatus?: (status: number) => boolean;
};

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
  inputKeys: BrowserApiKey[],
  rotationCursor: number,
  requestFactory: (apiKey: string, signal: AbortSignal) => Promise<Response>,
  options: KeyRotationOptions = {},
): Promise<RotatingKeyResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryNetworkErrors = options.retryNetworkErrors ?? true;
  const keyRejected = options.isKeyRejected ?? isKeyRejected;
  const retryableStatus = options.isRetryableStatus ?? isRetryableStatus;
  const keys = inputKeys.map((key) => ({ ...key }));
  if (keys.length === 0) {
    throw new ApiKeyPoolExhaustedError("No Gemini API keys are configured in this browser.", keys, 0);
  }

  const start = ((rotationCursor % keys.length) + keys.length) % keys.length;
  const nextCursor = (start + 1) % keys.length;
  const now = Date.now();
  const retryDates = keys
    .filter((key) => key.status === "COOLDOWN" && key.cooldownUntil)
    .map((key) => new Date(key.cooldownUntil as string))
    .filter((date) => Number.isFinite(date.getTime()) && date.getTime() > now)
    .sort((left, right) => left.getTime() - right.getTime());

  let readyCount = 0;
  let lastFailure = "Gemini request failed.";
  let lastRetryAt: Date | null = null;

  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (start + offset) % keys.length;
    const key = keys[index];
    if (key.status === "INVALID") continue;
    if (key.status === "COOLDOWN" && key.cooldownUntil) {
      const cooldownUntil = new Date(key.cooldownUntil);
      if (cooldownUntil.getTime() > now) {
        lastRetryAt = retryDates[0] ?? cooldownUntil;
        continue;
      }
      key.status = "ACTIVE";
      key.cooldownUntil = null;
    }

    readyCount += 1;
    key.lastUsedAt = new Date().toISOString();
    let response: Response;
    try {
      response = await requestFactory(key.value, AbortSignal.timeout(timeoutMs));
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "Gemini network request failed.";
      if (!retryNetworkErrors) break;
      continue;
    }

    if (response.ok) {
      key.status = "ACTIVE";
      key.failureCount = 0;
      key.cooldownUntil = null;
      return { response, keys, rotationCursor: (index + 1) % keys.length, usedKeyId: key.id };
    }

    const body = await response.clone().text().catch(() => "");
    if (isRateLimit(response.status, body)) {
      key.failureCount += 1;
      key.status = "COOLDOWN";
      key.cooldownUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS).toISOString();
      lastRetryAt = new Date(key.cooldownUntil);
      lastFailure = "Gemini rate limit reached for the current key.";
      continue;
    }

    if (keyRejected(response.status, body)) {
      key.failureCount += 1;
      key.status = "INVALID";
      key.cooldownUntil = null;
      lastFailure = "A Gemini key was rejected. Check its permissions or replace it.";
      continue;
    }

    if (retryableStatus(response.status) && offset < keys.length - 1) {
      lastFailure = `Gemini returned a temporary ${response.status} error.`;
      continue;
    }

    return { response, keys, rotationCursor: (index + 1) % keys.length, usedKeyId: key.id };
  }

  if (readyCount === 0 && retryDates.length > 0) {
    throw new ApiKeyPoolExhaustedError(
      `All usable Gemini keys are cooling down. Retry after ${retryDates[0].toLocaleTimeString()}.`,
      keys,
      nextCursor,
      retryDates[0],
    );
  }
  if (readyCount === 0 && keys.every((key) => key.status === "INVALID")) {
    throw new ApiKeyPoolExhaustedError("All Gemini keys were rejected and need to be replaced.", keys, nextCursor);
  }
  throw new ApiKeyPoolExhaustedError(lastFailure, keys, nextCursor, lastRetryAt);
}
