import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveFfmpegPath } from "@/lib/videoProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const execFile = promisify(execFileCallback);
const optionsSchema = z.object({
  duration: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  resolution: z.enum(["4k", "1080p"]),
  format: z.enum(["mp4", "mov"]),
  codecSpeed: z.enum(["slow", "medium"]),
  fps: z.literal(30),
});
const MAX_UPLOAD_BYTES = 140 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1_500 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  let workDirectory: string | undefined;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: "The rendered preview exceeds the 140 MB upload limit." }, { status: 413 });
  }
  try {
    const form = await request.formData();
    const file = form.get("video");
    const optionText = form.get("options");
    if (!(file instanceof File) || typeof optionText !== "string") {
      return NextResponse.json({ error: "A browser-rendered preview and export settings are required." }, { status: 400 });
    }
    if (file.size < 256 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "The rendered preview must be between 256 bytes and 140 MB." }, { status: 413 });
    }
    if (!file.type.startsWith("video/")) {
      return NextResponse.json({ error: "The uploaded render is not a supported video stream." }, { status: 415 });
    }

    let rawOptions: unknown;
    try {
      rawOptions = JSON.parse(optionText);
    } catch {
      return NextResponse.json({ error: "Export settings are not valid JSON." }, { status: 400 });
    }
    const parsedOptions = optionsSchema.safeParse(rawOptions);
    if (!parsedOptions.success) {
      return NextResponse.json({ error: "Choose a supported duration, format, resolution, and codec speed." }, { status: 400 });
    }

    const options = parsedOptions.data;
    const ffmpegPath = resolveFfmpegPath();
    workDirectory = await mkdtemp(join(tmpdir(), "motion-ai-render-"));
    const inputPath = join(workDirectory, "capture.webm");
    const outputName = `motion-ai-studio-${new Date().toISOString().replace(/[:.]/g, "-")}.${options.format}`;
    const outputPath = join(workDirectory, outputName);
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const width = options.resolution === "4k" ? 3840 : 1920;
    const height = options.resolution === "4k" ? 2160 : 1080;
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${options.fps},format=yuv420p`;
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-t", String(options.duration),
      "-vf", filter,
      "-an",
      "-c:v", "libx264",
      "-preset", options.codecSpeed === "slow" ? "slow" : "medium",
      "-crf", options.resolution === "4k" ? "19" : "18",
      "-profile:v", "high",
      "-level:v", options.resolution === "4k" ? "5.1" : "4.2",
      "-r", String(options.fps),
      "-movflags", "+faststart",
      outputPath,
    ];

    await execFile(ffmpegPath, args, {
      timeout: Math.max(180_000, options.duration * 30_000),
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      signal: request.signal,
    });

    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || outputStat.size < 1 || outputStat.size > MAX_OUTPUT_BYTES) {
      throw new Error("The encoded render is empty or exceeds the delivery limit.");
    }

    const stream = createReadStream(outputPath);
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned || !workDirectory) return;
      cleaned = true;
      void rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    };
    stream.once("close", cleanup);
    stream.once("error", cleanup);
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const contentType = options.format === "mp4" ? "video/mp4" : "video/quicktime";
    return new Response(webStream, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(outputStat.size),
        "content-disposition": `attachment; filename="${basename(outputName)}"`,
        "cache-control": "no-store",
        "x-motion-resolution": options.resolution,
        "x-motion-frame-rate": String(options.fps),
      },
    });
  } catch (error) {
    if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "The video could not be rendered.";
    console.error("Video render failed:", error);
    if (message.includes("FFmpeg is not installed")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    const errorCode = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (message.includes("timed out") || errorCode === "ETIMEDOUT") {
      return NextResponse.json({ error: "The render took too long. Try a shorter duration or 1080p." }, { status: 504 });
    }
    return NextResponse.json({ error: "FFmpeg could not encode this render. Try a shorter duration or 1080p." }, { status: 500 });
  }
}
