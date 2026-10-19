import { accessSync, constants } from "node:fs";
import { join } from "node:path";

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveFfmpegPath(): string {
  const override = process.env.FFMPEG_PATH?.trim();
  if (override && isExecutable(override)) return override;

  const bundledPath = join(process.cwd(), "node_modules", "ffmpeg-static-electron-v5-linux-x64", "bin", "linux", "x64", "ffmpeg");
  if (isExecutable(bundledPath)) return bundledPath;

  throw new Error("FFmpeg is not installed. Install the bundled Linux x64 package or set FFMPEG_PATH to a trusted executable FFmpeg binary.");
}
