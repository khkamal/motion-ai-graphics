import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static-electron-v5-linux-x64"],
  outputFileTracingIncludes: {
    "/api/render": ["./node_modules/ffmpeg-static-electron-v5-linux-x64/index.js", "./node_modules/ffmpeg-static-electron-v5-linux-x64/bin/linux/x64/ffmpeg"],
  },
};

export default nextConfig;
