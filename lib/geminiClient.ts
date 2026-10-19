import { requestWithRotatingKey } from "@/lib/keyRotator";
import type { DynamicVariation } from "@/lib/variation";
import type { MotionMode } from "@/lib/presets";

export type GeminiImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
};

export type PromptVariationRequest = {
  workspaceId: string;
  image: GeminiImage;
  basePrompt: string;
  modifier: string;
  mode: MotionMode;
  presetName: string;
  variation: DynamicVariation;
};

export type PromptVariationResult = {
  prompt: string;
  aiEnhanced: boolean;
  notice?: string;
};

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  return candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join(" ").trim() ?? "";
}

export async function createGeminiMotionPrompt(input: PromptVariationRequest): Promise<PromptVariationResult> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const basePrompt = input.basePrompt.trim() || "Read the image composition and identify its central subject.";
  const modifier = input.modifier.trim() || "No additional element changes requested.";
  const systemBrief = [
    "You are a senior motion designer creating a fresh image-to-video direction for a stock-safe motion graphics sequence.",
    "Analyze the supplied reference image and produce one concise but vivid production prompt of 90 to 150 words.",
    "Keep the visible subject recognizable. Describe camera, timing, depth, lighting, and particle behavior with concrete instructions.",
    "Do not claim to generate video, add text, logos, watermarks, or unrelated objects. Avoid generic repeated camera moves.",
    `Mode: ${input.mode}. Preset: ${input.presetName}. Base direction: ${basePrompt}. User modifier: ${modifier}.`,
    `Cryptographic variation seed: ${input.variation.seed}. Treat this as a distinct motion signature, not visible text.`,
    `Style ingredients: palette ${input.variation.palette}; camera ${input.variation.camera}; lighting ${input.variation.lighting}; particles ${input.variation.particles}; surface ${input.variation.texture}; rhythm ${input.variation.rhythm}.`,
    `Motion controls: ${input.variation.easing}; phase offset ${input.variation.phaseDegrees} degrees; orbit ${input.variation.orbitDegrees} degrees; particle density ${input.variation.particleDensity} percent.`,
    "Return only the final motion prompt, without markdown or a heading.",
  ].join(" ");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await requestWithRotatingKey(input.workspaceId, (apiKey, signal) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: systemBrief },
                { inline_data: { mime_type: input.image.mimeType, data: input.image.data } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.94,
            topP: 0.94,
            maxOutputTokens: 420,
          },
        }),
        signal,
      }),
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini ${response.status}: ${detail.slice(0, 500)}`);
    }

    const payload: unknown = await response.json();
    const prompt = extractGeminiText(payload);
    if (!prompt) throw new Error("Gemini returned an empty motion prompt.");
    return { prompt, aiEnhanced: true };
  } catch (error) {
    const notice = error instanceof Error ? error.message : "Gemini prompt refinement is temporarily unavailable.";
    return {
      prompt: "",
      aiEnhanced: false,
      notice: notice.includes("No Gemini API keys")
        ? "Gemini is not connected. A unique local motion direction was created instead."
        : notice.includes("cooling down") || notice.includes("rate limit")
          ? "Gemini keys are rate-limited. A unique local motion direction was created instead."
          : "Gemini could not be reached. A unique local motion direction was created instead.",
    };
  }
}
