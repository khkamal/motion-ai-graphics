import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGenerationRecord, saveGenerationResult } from "@/lib/database";
import { createGeminiMotionPrompt, type GeminiImage } from "@/lib/geminiClient";
import { jsonError } from "@/lib/http";
import { attachWorkspaceCookie, resolveWorkspace } from "@/lib/workspace";
import { buildLocalMotionPrompt, createDynamicVariation } from "@/lib/variation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  image: z.object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    data: z.string().min(100).max(16_000_000),
  }),
  basePrompt: z.string().max(1_200).default(""),
  modifier: z.string().max(600).default(""),
  mode: z.enum(["2d", "3d", "line-art"]),
  presetName: z.string().min(1).max(80),
});

function validateImageData(image: GeminiImage): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
  const byteLength = Math.floor((image.data.length * 3) / 4);
  return byteLength >= 64 && byteLength <= 12 * 1024 * 1024;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let workspaceId: string | undefined;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 18 * 1024 * 1024) return jsonError("The generation request is too large. Resize the reference image and try again.", 413);
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Check the image, prompt, mode, and preset before generating.", 400, parsed.error.flatten());
    }
    if (!validateImageData(parsed.data.image)) return jsonError("The reference image payload is invalid or too large.", 400);

    workspaceId = await resolveWorkspace(request);
    const input = parsed.data;
    const variation = await createDynamicVariation({
      workspaceId,
      mode: input.mode,
      presetName: input.presetName,
      basePrompt: input.basePrompt,
    });

    const generationId = createGenerationRecord({
      workspaceId,
      seed: variation.seed,
      styleSignature: variation.signature,
      mode: input.mode,
      presetName: input.presetName,
      basePrompt: input.basePrompt,
      status: "PROMPTING",
    });

    const aiResult = await createGeminiMotionPrompt({
      workspaceId,
      image: input.image,
      basePrompt: input.basePrompt,
      modifier: input.modifier,
      mode: input.mode,
      presetName: input.presetName,
      variation,
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

    saveGenerationResult(generationId, prompt, aiResult.aiEnhanced, aiResult.aiEnhanced ? "READY" : "LOCAL_FALLBACK");

    const response = NextResponse.json({
      generationId,
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
      createdAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
    return attachWorkspaceCookie(response, workspaceId);
  } catch (error) {
    console.error("Motion prompt generation failed:", error);
    const message = error instanceof Error ? error.message : "Motion prompt generation failed.";
    const response = jsonError(message.includes("fetch failed") ? "The generation service is temporarily unavailable." : "The motion direction could not be generated. Please try again.", 500);
    return workspaceId ? attachWorkspaceCookie(response, workspaceId) : response;
  }
}
