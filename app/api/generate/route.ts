import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGeminiMotionPrompt, type GeminiImage } from "@/lib/geminiClient";
import { jsonError } from "@/lib/http";
import { buildLocalMotionPrompt, createDynamicVariation } from "@/lib/variation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  basePrompt: z.string().max(1_200).default(""),
  modifier: z.string().max(600).default(""),
  mode: z.enum(["2d", "3d", "line-art"]),
  presetName: z.string().min(1).max(80),
  keys: z.array(browserKeySchema).max(10).default([]),
  rotationCursor: z.number().int().nonnegative().max(1_000_000).default(0),
  recentSignatures: z.array(z.string().min(1).max(128)).max(500).default([]),
});

function validateImageData(image: GeminiImage): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
  const byteLength = Math.floor((image.data.length * 3) / 4);
  return byteLength >= 64 && byteLength <= 12 * 1024 * 1024;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 18 * 1024 * 1024) {
    return jsonError("The generation request is too large. Resize the reference image and try again.", 413);
  }

  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Check the image, prompt, mode, preset, and browser key pool before generating.", 400, parsed.error.flatten());
    }
    if (!validateImageData(parsed.data.image)) return jsonError("The reference image payload is invalid or too large.", 400);

    const input = parsed.data;
    const variation = await createDynamicVariation({
      mode: input.mode,
      presetName: input.presetName,
      basePrompt: input.basePrompt,
      recentSignatures: input.recentSignatures,
    });
    const aiResult = await createGeminiMotionPrompt({
      image: input.image,
      basePrompt: input.basePrompt,
      modifier: input.modifier,
      mode: input.mode,
      presetName: input.presetName,
      variation,
      keys: input.keys,
      rotationCursor: input.rotationCursor,
    });
    const prompt = aiResult.aiEnhanced
      ? aiResult.prompt
      : buildLocalMotionPrompt({
          basePrompt: input.basePrompt,
          modifier: input.modifier,
          mode: input.mode,
          presetName: input.presetName,
          variation,
        });

    return NextResponse.json({
      generationId: `gen_${randomUUID().replace(/-/g, "")}`,
      seed: variation.seed,
      styleSignature: variation.signature,
      style: {
        palette: variation.palette,
        camera: variation.camera,
        lighting: variation.lighting,
        particles: variation.particles,
        texture: variation.texture,
        rhythm: variation.rhythm,
        phaseDegrees: variation.phaseDegrees,
        orbitDegrees: variation.orbitDegrees,
        particleDensity: variation.particleDensity,
        easing: variation.easing,
      },
      prompt,
      aiEnhanced: aiResult.aiEnhanced,
      notice: aiResult.notice ?? null,
      keyUpdates: aiResult.keys.map(({ id, status, failureCount, cooldownUntil, lastUsedAt }) => ({
        id,
        status,
        failureCount,
        cooldownUntil,
        lastUsedAt,
      })),
      rotationCursor: aiResult.rotationCursor,
      createdAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Motion prompt generation failed:", error);
    const message = error instanceof Error ? error.message : "Motion prompt generation failed.";
    const response = jsonError(message.includes("fetch failed") ? "The generation service is temporarily unavailable." : "The motion direction could not be generated. Please try again.", 500);
    return response;
  }
}
