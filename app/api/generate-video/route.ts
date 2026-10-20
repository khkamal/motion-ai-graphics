import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiKeyPoolExhaustedError, requestWithRotatingKey } from "@/lib/keyRotator";
import type { BrowserApiKey, BrowserApiKeyUpdate } from "@/lib/browserKeyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const VIDEO_MODEL = "gemini-omni-1.1-flash";
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 210_000;
const FILE_POLL_INTERVAL_MS = 1_000;
const FILE_POLL_ATTEMPTS = 10;

const browserKeySchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  masked: z.string().max(32),
  value: z.string().min(20).max(256).regex(/^\S+$/, "API keys cannot contain whitespace."),
  status: z.enum(["ACTIVE", "COOLDOWN", "INVALID"]),
  failureCount: z.number().int().min(0).max(1_000),
  cooldownUntil: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
});

const requestSchema = z.object({
  image: z.object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().min(100).max(16_000_000),
  }),
  prompt: z.string().min(1).max(4_000),
  mode: z.enum(["2d", "3d", "line-art"]),
  presetName: z.string().min(1).max(80),
  backgroundMode: z.enum(["original", "transparent", "green", "blue", "custom"]),
  customBackground: z.string().regex(/^#[0-9a-f]{6}$/i),
  keys: z.array(browserKeySchema).max(10).default([]),
  rotationCursor: z.number().int().nonnegative().max(1_000_000).default(0),
});

type VideoContent = {
  mimeType: string;
  data?: string;
  uri?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateImageData(data: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const byteLength = Math.floor((data.length * 3) / 4);
  return byteLength >= 64 && byteLength <= MAX_IMAGE_BYTES;
}

function buildVideoPrompt(input: z.infer<typeof requestSchema>): string {
  const backgroundDirection = input.backgroundMode === "green"
    ? "Replace the entire background with a flat, evenly lit chroma green (#00E65A), with clean subject edges and no green reflections."
    : input.backgroundMode === "blue"
      ? "Replace the entire background with a flat, evenly lit chroma blue (#086DFF), with clean subject edges and no blue reflections."
      : input.backgroundMode === "custom"
        ? `Use a flat, evenly lit background in the exact color ${input.customBackground.toUpperCase()}, with clean subject edges.`
        : input.backgroundMode === "transparent"
          ? "Keep the original background visually simple and restrained. The final generated MP4 is opaque and cannot contain an alpha channel."
          : "Preserve the reference image's original background, atmosphere, and lighting.";

  return [
    "IMAGE-TO-VIDEO: animate the supplied image as the exact first frame and visual source of truth.",
    `Creative direction: ${input.prompt.trim()}`,
    `Visual language: ${input.mode === "line-art" ? "line art" : input.mode}, using the ${input.presetName} treatment.`,
    "Preserve the recognizable subject, silhouette, layout, original colors, and all existing lettering or brand marks. Animate the existing artwork; do not replace, redraw, erase, morph, or redesign it.",
    "Create a polished, single continuous 16:9 motion-graphics shot with smooth, physically coherent movement, subtle depth, stable fine details, and no flicker, jump cuts, camera shake, added props, added text, or watermark.",
    backgroundDirection,
    "Let the motion resolve toward the opening composition so the clip can be looped cleanly. Keep the visual subject centered and fully inside frame. Do not add audio.",
  ].join("\n\n");
}

function findVideoContent(payload: unknown): VideoContent | null {
  if (!isRecord(payload)) return null;
  const sdkOutput = payload.output_video;
  if (isRecord(sdkOutput)) {
    const data = typeof sdkOutput.data === "string" ? sdkOutput.data : undefined;
    const uri = typeof sdkOutput.uri === "string" ? sdkOutput.uri : undefined;
    if (data || uri) {
      return {
        mimeType: typeof sdkOutput.mime_type === "string" ? sdkOutput.mime_type : "video/mp4",
        ...(data ? { data } : {}),
        ...(uri ? { uri } : {}),
      };
    }
  }

  if (!Array.isArray(payload.steps)) return null;
  for (const step of [...payload.steps].reverse()) {
    if (!isRecord(step) || !Array.isArray(step.content)) continue;
    for (const content of step.content) {
      if (!isRecord(content) || content.type !== "video") continue;
      const data = typeof content.data === "string" ? content.data : undefined;
      const uri = typeof content.uri === "string" ? content.uri : undefined;
      if (!data && !uri) continue;
      return {
        mimeType: typeof content.mime_type === "string" ? content.mime_type : "video/mp4",
        ...(data ? { data } : {}),
        ...(uri ? { uri } : {}),
      };
    }
  }
  return null;
}

function getKeyUpdates(keys: BrowserApiKey[]): BrowserApiKeyUpdate[] {
  return keys.map(({ id, status, failureCount, cooldownUntil, lastUsedAt }) => ({
    id,
    status,
    failureCount,
    cooldownUntil,
    lastUsedAt,
  }));
}

function getKeyHeaders(keys: BrowserApiKey[], rotationCursor: number): Record<string, string> {
  return {
    "x-gemini-key-updates": Buffer.from(JSON.stringify(getKeyUpdates(keys)), "utf8").toString("base64url"),
    "x-gemini-rotation-cursor": String(rotationCursor),
  };
}

function jsonVideoError(
  message: string,
  status: number,
  keys: BrowserApiKey[] = [],
  rotationCursor = 0,
): NextResponse {
  return NextResponse.json({
    error: message,
    keyUpdates: getKeyUpdates(keys),
    rotationCursor,
  }, { status, headers: { "cache-control": "no-store" } });
}

function isActuallyInvalidApiKey(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  return /(?:api[ _-]?key.{0,32}(?:invalid|not valid|revoked)|(?:invalid|revoked).{0,32}api[ _-]?key)/i.test(body);
}

function readProviderMessage(body: string): string {
  try {
    const payload: unknown = JSON.parse(body);
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  } catch {
    // Provider error responses are not always JSON.
  }
  return body.trim().slice(0, 500);
}

function providerErrorMessage(status: number, body: string, apiKey: string): string {
  const detail = readProviderMessage(body).replaceAll(apiKey, "[redacted]");
  if (status === 403 || status === 404 || /(?:model|billing|permission|not enabled|access).{0,50}(?:video|omni|available|allowed|project|model)?/i.test(detail)) {
    return `This Gemini project cannot access ${VIDEO_MODEL}. Use a project with video-generation access; billing may be required. The API key has not been marked invalid. ${detail ? `Provider detail: ${detail}` : ""}`.trim();
  }
  if (status === 429) return "Gemini video generation is rate-limited. Add another Gemini key or retry after its cooldown.";
  if (status >= 500) return "Gemini's video-generation service is temporarily unavailable. No procedural video was substituted.";
  return `Gemini Omni Flash rejected the video request${detail ? `: ${detail}` : ` (HTTP ${status})`}. No procedural video was substituted.`;
}

function getHostedFileId(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "https:" || parsed.hostname !== "generativelanguage.googleapis.com") return null;
    const match = parsed.pathname.match(/^\/v1beta\/files\/([^/:]+)(?::download)?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function validateMp4(buffer: Buffer): boolean {
  return buffer.length >= 256 && buffer.length <= MAX_VIDEO_BYTES && buffer.toString("ascii", 4, 8) === "ftyp";
}

function createBufferStream(buffer: Buffer): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buffer.length) {
        controller.close();
        return;
      }
      const end = Math.min(buffer.length, offset + 512 * 1024);
      controller.enqueue(buffer.subarray(offset, end));
      offset = end;
    },
  });
}

async function deleteHostedFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await fetch(`${GEMINI_API_ROOT}/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });
  } catch {
    // Google automatically deletes Files API uploads and generated files after their retention window.
  }
}

async function createValidatedDownloadStream(
  source: ReadableStream<Uint8Array> | null,
  contentLengthHeader: string | null,
  cleanup: () => Promise<void>,
): Promise<{ stream: ReadableStream<Uint8Array>; contentLength: string | null }> {
  const declaredLength = Number(contentLengthHeader ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VIDEO_BYTES) {
    throw new Error("The generated video exceeds the 100 MB delivery limit.");
  }
  if (!source) throw new Error("Google returned an empty video download.");

  const reader = source.getReader();
  const initialChunks: Uint8Array[] = [];
  let headerBytes = Buffer.alloc(0);
  let totalLength = 0;
  try {
    while (headerBytes.length < 8) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Google returned an incomplete video download.");
      if (!value.byteLength) continue;
      totalLength += value.byteLength;
      if (totalLength > MAX_VIDEO_BYTES) throw new Error("The generated video exceeds the 100 MB delivery limit.");
      initialChunks.push(value);
      headerBytes = Buffer.concat([headerBytes, Buffer.from(value)]);
    }
    if (headerBytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("Google returned an unsupported video format.");
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    try { reader.releaseLock(); } catch { /* The stream may already be closed. */ }
    throw error;
  }

  let cleaned = false;
  const cleanupOnce = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await cleanup();
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const queued = initialChunks.shift();
        if (queued) {
          controller.enqueue(queued);
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await cleanupOnce();
          try { reader.releaseLock(); } catch { /* The stream is already closed. */ }
          return;
        }
        if (!value.byteLength) return;
        totalLength += value.byteLength;
        if (totalLength > MAX_VIDEO_BYTES) {
          const error = new Error("The generated video exceeds the 100 MB delivery limit.");
          await reader.cancel(error).catch(() => undefined);
          controller.error(error);
          await cleanupOnce();
          try { reader.releaseLock(); } catch { /* The stream is already closed. */ }
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        await cleanupOnce();
        try { reader.releaseLock(); } catch { /* The stream is already closed. */ }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await cleanupOnce();
      try { reader.releaseLock(); } catch { /* The stream is already closed. */ }
    },
  });

  return {
    stream,
    contentLength: Number.isSafeInteger(declaredLength) && declaredLength > 0 ? String(declaredLength) : null,
  };
}

async function waitForHostedFile(apiKey: string, fileId: string, signal: AbortSignal): Promise<boolean> {
  const infoUrl = `${GEMINI_API_ROOT}/files/${encodeURIComponent(fileId)}`;
  for (let attempt = 0; attempt < FILE_POLL_ATTEMPTS; attempt += 1) {
    const pollSignal = AbortSignal.any([AbortSignal.timeout(2_500), signal]);
    const response = await fetch(infoUrl, {
      headers: { "x-goog-api-key": apiKey },
      signal: pollSignal,
      cache: "no-store",
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) return false;
    const stateValue = payload.state;
    const state = typeof stateValue === "string"
      ? stateValue.toUpperCase()
      : isRecord(stateValue) && typeof stateValue.name === "string"
        ? stateValue.name.toUpperCase()
        : "";
    if (state === "ACTIVE") return true;
    if (state === "FAILED") return false;
    if (attempt < FILE_POLL_ATTEMPTS - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, FILE_POLL_INTERVAL_MS));
    }
  }
  return false;
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonVideoError("The video-generation request is too large. Resize the reference image and try again.", 413);
  }

  let hostedFile: { apiKey: string; id: string } | null = null;
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonVideoError("Check the reference image, motion brief, settings, and Gemini key pool before generating.", 400);
    }
    const input = parsed.data;
    if (!validateImageData(input.image.data)) return jsonVideoError("The reference image payload is invalid or too large.", 400);
    if (input.keys.length === 0) {
      return jsonVideoError("Add a Gemini API key in Settings. Real video generation uses Gemini Omni Flash and may require a billing-enabled project.", 401);
    }

    const prompt = buildVideoPrompt(input);
    const requestBody = JSON.stringify({
      model: VIDEO_MODEL,
      input: [
        { type: "image", data: input.image.data, mime_type: input.image.mimeType },
        { type: "text", text: prompt },
      ],
      generation_config: {
        video_config: { task: "image_to_video" },
      },
      response_format: {
        type: "video",
        resolution: "1080p",
        aspect_ratio: "16:9",
        delivery: "uri",
      },
      background: false,
      store: false,
    });

    let rotatingResult;
    try {
      rotatingResult = await requestWithRotatingKey(
        input.keys,
        input.rotationCursor,
        (apiKey, timeoutSignal) => fetch(`${GEMINI_API_ROOT}/interactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: requestBody,
          signal: AbortSignal.any([timeoutSignal, request.signal]),
          cache: "no-store",
        }),
        {
          timeoutMs: GENERATION_TIMEOUT_MS,
          retryNetworkErrors: false,
          isKeyRejected: isActuallyInvalidApiKey,
          isRetryableStatus: () => false,
        },
      );
    } catch (error) {
      if (error instanceof ApiKeyPoolExhaustedError) {
        const timedOut = /timeout|timed out|aborted/i.test(error.message);
        return jsonVideoError(
          timedOut
            ? "Gemini Omni Flash took too long to finish this video. Try again later or use a shorter, simpler direction."
            : error.message,
          timedOut ? 504 : error.retryAt ? 429 : 503,
          error.keys,
          error.rotationCursor,
        );
      }
      throw error;
    }

    const { response, keys, rotationCursor, usedKeyId } = rotatingResult;
    const apiKey = keys.find((key) => key.id === usedKeyId)?.value;
    if (!apiKey) return jsonVideoError("The Gemini key rotation state could not be verified.", 500, keys, rotationCursor);

    if (!response.ok) {
      const providerBody = await response.text().catch(() => "");
      const status = response.status === 400 ? 422 : response.status === 404 ? 403 : response.status >= 500 ? 502 : response.status;
      return jsonVideoError(providerErrorMessage(response.status, providerBody, apiKey), status, keys, rotationCursor);
    }

    const interaction: unknown = await response.json().catch(() => null);
    const video = findVideoContent(interaction);
    if (!video || !video.mimeType.startsWith("video/")) {
      return jsonVideoError("Gemini did not return a usable video file. No procedural fallback was used.", 502, keys, rotationCursor);
    }

    let videoStream: ReadableStream<Uint8Array>;
    let outputLength: string | null = null;
    if (video.uri) {
      const fileId = getHostedFileId(video.uri);
      if (!fileId) return jsonVideoError("Gemini returned an unsupported video download URI.", 502, keys, rotationCursor);
      hostedFile = { apiKey, id: fileId };
      const fileReady = await waitForHostedFile(apiKey, fileId, request.signal);
      if (!fileReady) {
        return jsonVideoError("Gemini created the video, but its temporary download file did not become ready. Try again.", 502, keys, rotationCursor);
      }
      const downloadUrl = `${GEMINI_API_ROOT}/files/${encodeURIComponent(fileId)}:download?alt=media`;
      const downloadResponse = await fetch(downloadUrl, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.any([AbortSignal.timeout(40_000), request.signal]),
        cache: "no-store",
      });
      if (!downloadResponse.ok) {
        return jsonVideoError("Gemini could not download the generated MP4. Its temporary output will be cleaned up automatically.", 502, keys, rotationCursor);
      }
      const hostedStream = await createValidatedDownloadStream(
        downloadResponse.body,
        downloadResponse.headers.get("content-length"),
        () => deleteHostedFile(apiKey, fileId),
      );
      videoStream = hostedStream.stream;
      outputLength = hostedStream.contentLength;
      hostedFile = null;
    } else if (video.data) {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(video.data)) {
        return jsonVideoError("Gemini returned an invalid encoded video. No fallback was used.", 502, keys, rotationCursor);
      }
      const mp4 = Buffer.from(video.data, "base64");
      if (!validateMp4(mp4)) {
        return jsonVideoError("Gemini returned a corrupt or unsupported MP4. No procedural fallback was used.", 502, keys, rotationCursor);
      }
      videoStream = createBufferStream(mp4);
      outputLength = String(mp4.length);
    } else {
      return jsonVideoError("Gemini returned no downloadable MP4. No procedural fallback was used.", 502, keys, rotationCursor);
    }

    const headers = new Headers({
      "content-type": "video/mp4",
      "content-disposition": 'inline; filename="motion-ai-studio-ai-video.mp4"',
      "cache-control": "no-store",
      "x-motion-ai-model": VIDEO_MODEL,
      "x-motion-ai-resolution": "1080p",
      ...getKeyHeaders(keys, rotationCursor),
    });
    if (outputLength) headers.set("content-length", outputLength);
    return new Response(videoStream, { status: 200, headers });
  } catch (error) {
    console.error("Gemini video generation failed:", error);
    const message = error instanceof Error ? error.message : "Gemini video generation failed.";
    const timedOut = /timeout|timed out|aborted/i.test(message);
    return jsonVideoError(
      timedOut
        ? "Gemini Omni Flash took too long to finish this video. Try again later or use a shorter, simpler direction."
        : "Gemini Omni Flash could not generate a video right now. Check model access, billing, and connection, then try again. No procedural fallback was used.",
      timedOut ? 504 : 502,
    );
  } finally {
    if (hostedFile) await deleteHostedFile(hostedFile.apiKey, hostedFile.id);
  }
}
