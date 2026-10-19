"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Maximize2, Sparkles } from "lucide-react";
import type { BackgroundMode, MotionMode, StudioPreset } from "@/lib/presets";
import type { RenderSettings } from "@/components/RenderModal";

export type StudioCanvasHandle = {
  record: (
    settings: RenderSettings,
    onProgress: (value: number, label?: string) => void,
  ) => Promise<Blob>;
};

type StudioCanvasProps = {
  imageUrl: string | null;
  imageName?: string;
  mode: MotionMode;
  preset: StudioPreset;
  seed: string;
  speed: number;
  playing: boolean;
  backgroundMode: BackgroundMode;
  customBackground: string;
  particleScale: number;
  seekTime: number;
  seekRevision: number;
};

type Particle = { x: number; y: number; size: number; phase: number; speed: number; drift: number; alpha: number };

type SceneState = {
  imageUrl: string | null;
  mode: MotionMode;
  preset: StudioPreset;
  seed: string;
  speed: number;
  playing: boolean;
  backgroundMode: BackgroundMode;
  customBackground: string;
  particleScale: number;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let value = seed || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
  const number = Number.parseInt(value, 16);
  if (!Number.isFinite(number)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
}

function getBackgroundColor(state: SceneState): string {
  switch (state.backgroundMode) {
    case "green": return "#00e65a";
    case "blue": return "#086dff";
    case "custom": return state.customBackground;
    default: return state.preset.palette.base;
  }
}

function drawCheckerboard(context: CanvasRenderingContext2D, width: number, height: number): void {
  const tile = Math.max(16, Math.round(width / 70));
  context.fillStyle = "#e5e8eb";
  context.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      if (((x / tile) + (y / tile)) % 2 === 0) {
        context.fillStyle = "#c9cdd2";
        context.fillRect(x, y, tile, tile);
      }
    }
  }
}

function createParticles(seed: string, amount: number): Particle[] {
  const random = seededRandom(hashString(seed));
  return Array.from({ length: amount }, () => ({
    x: random(),
    y: random(),
    size: 0.0025 + random() * 0.007,
    phase: random() * Math.PI * 2,
    speed: 0.08 + random() * 0.42,
    drift: -0.08 + random() * 0.16,
    alpha: 0.18 + random() * 0.58,
  }));
}

const StudioCanvas = forwardRef<StudioCanvasHandle, StudioCanvasProps>(function StudioCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const sceneRef = useRef<SceneState>(props);
  const elapsedRef = useRef(0);
  const previousFrameRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  sceneRef.current = props;

  useEffect(() => {
    particlesRef.current = createParticles(`${props.seed}:${props.preset.id}`, Math.max(26, props.preset.particleCount));
    elapsedRef.current = 0;
  }, [props.seed, props.preset.id, props.preset.particleCount]);

  useEffect(() => {
    elapsedRef.current = props.seekTime;
    previousFrameRef.current = 0;
  }, [props.seekRevision]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    const setPreviewSize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      const width = Math.round(bounds.width * ratio);
      const height = Math.round(bounds.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(setPreviewSize);
    resizeObserverRef.current.observe(canvas);
    setPreviewSize();

    let frameId = 0;
    let disposed = false;
    const sourceUrl = props.imageUrl;
    const image = sourceUrl ? new Image() : null;
    imageRef.current = image;
    if (image && sourceUrl) {
      image.decoding = "async";
      image.src = sourceUrl;
    }

    const drawFrame = (timestamp: number): void => {
      if (disposed) return;
      const state = sceneRef.current;
      const width = canvas.width;
      const height = canvas.height;
      if (!width || !height) {
        frameId = window.requestAnimationFrame(drawFrame);
        return;
      }

      if (width >= 3840 && previousFrameRef.current && timestamp - previousFrameRef.current < 1000 / 30) {
        frameId = window.requestAnimationFrame(drawFrame);
        return;
      }
      const delta = previousFrameRef.current ? Math.min(0.05, (timestamp - previousFrameRef.current) / 1000) : 0;
      previousFrameRef.current = timestamp;
      if (state.playing) elapsedRef.current += delta * state.speed;
      const time = elapsedRef.current;
      context.save();
      context.clearRect(0, 0, width, height);

      if (state.backgroundMode === "transparent") {
        drawCheckerboard(context, width, height);
      } else {
        const base = getBackgroundColor(state);
        context.fillStyle = base;
        context.fillRect(0, 0, width, height);
        const glowX = width * (0.49 + Math.sin(time * 0.14) * 0.09);
        const glowY = height * (0.45 + Math.cos(time * 0.12) * 0.07);
        const gradient = context.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * 0.7);
        gradient.addColorStop(0, rgba(state.preset.palette.accent, state.backgroundMode === "original" ? 0.14 : 0.06));
        gradient.addColorStop(0.52, rgba(state.preset.palette.highlight, 0.04));
        gradient.addColorStop(1, "rgba(5,7,11,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }

      if (state.backgroundMode === "original" || state.backgroundMode === "transparent") {
        const wash = context.createLinearGradient(0, 0, width, height);
        wash.addColorStop(0, rgba(state.preset.palette.secondary, 0.05));
        wash.addColorStop(0.53, "rgba(0,0,0,0)");
        wash.addColorStop(1, rgba(state.preset.palette.accent, 0.08));
        context.fillStyle = wash;
        context.fillRect(0, 0, width, height);
      }

      const image = imageRef.current;
      if (image && image.complete && image.naturalWidth > 0) {
        const naturalWidth = image.naturalWidth;
        const naturalHeight = image.naturalHeight;
        const fit = Math.max(width / naturalWidth, height / naturalHeight);
        const motionAmount = 0.012 + state.preset.intensity * 0.028;
        const orbit = Math.sin(time * (state.preset.motion === "orbit" ? 0.32 : 0.2) + 0.2) * motionAmount;
        const driftX = Math.sin(time * 0.17 + 0.6) * width * 0.009;
        const driftY = Math.cos(time * 0.13 + 1.2) * height * 0.009;
        const zoom = 1.018 + (Math.sin(time * 0.21) + 1) * 0.013 * state.preset.intensity;
        const rotation = state.mode === "3d" ? Math.sin(time * 0.2) * 0.015 : state.mode === "line-art" ? Math.sin(time * 0.12) * 0.003 : 0;
        const drawWidth = naturalWidth * fit * zoom;
        const drawHeight = naturalHeight * fit * zoom;

        context.save();
        context.translate(width / 2 + driftX, height / 2 + driftY);
        context.rotate(rotation + orbit * 0.12);
        if (state.mode === "3d") {
          const depth = Math.sin(time * 0.18) * 0.012;
          context.transform(1, depth * 0.18, depth, 1, 0, 0);
        }
        context.globalAlpha = 0.18;
        context.filter = "blur(20px) saturate(1.1)";
        context.drawImage(image, -drawWidth / 2 - 4, -drawHeight / 2 + 5, drawWidth + 8, drawHeight + 8);
        context.globalAlpha = 1;
        context.filter = state.mode === "line-art" ? "grayscale(1) contrast(1.35) brightness(1.12)" : state.mode === "3d" ? "saturate(1.12) contrast(1.03)" : "saturate(1.04)";
        context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        context.filter = "none";
        if (state.mode === "line-art") {
          context.globalCompositeOperation = "screen";
          context.globalAlpha = 0.11;
          context.drawImage(image, -drawWidth / 2 - 2, -drawHeight / 2, drawWidth, drawHeight);
          context.globalAlpha = 1;
          context.globalCompositeOperation = "source-over";
        }
        context.restore();

        const vignette = context.createRadialGradient(width / 2, height / 2, height * 0.16, width / 2, height / 2, Math.max(width, height) * 0.73);
        vignette.addColorStop(0, "rgba(4,6,10,0)");
        vignette.addColorStop(1, "rgba(4,6,10,0.34)");
        context.fillStyle = vignette;
        context.fillRect(0, 0, width, height);
      } else if (!image) {
        drawAbstractArtwork(context, width, height, time, state);
      } else if (image.complete && image.naturalWidth === 0) {
        context.fillStyle = "rgba(240,243,247,0.76)";
        context.font = `${Math.max(14, Math.round(width * 0.016))}px Inter, sans-serif`;
        context.textAlign = "center";
        context.fillText("This image could not be displayed", width / 2, height / 2);
      }

      drawParticles(context, width, height, time, state, particlesRef.current);
      drawAmbientLines(context, width, height, time, state);
      context.restore();
      frameId = window.requestAnimationFrame(drawFrame);
    };

    frameId = window.requestAnimationFrame(drawFrame);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      previousFrameRef.current = 0;
    };
  }, [props.imageUrl]);

  useImperativeHandle(ref, () => ({
    async record(settings, onProgress): Promise<Blob> {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("The motion stage is not ready to capture.");
      if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
        throw new Error("Video capture is not supported in this browser. Use an up-to-date desktop version of Chrome, Edge, or Firefox.");
      }

      const originalWidth = canvas.width;
      const originalHeight = canvas.height;
      const width = settings.resolution === "4k" ? 3840 : 1920;
      const height = settings.resolution === "4k" ? 2160 : 1080;
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser cannot record a WebM capture for FFmpeg.");

      canvas.width = width;
      canvas.height = height;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const stream = canvas.captureStream(settings.fps);
      const bitrate = settings.resolution === "4k" ? 12_000_000 : 6_000_000;
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        throw new Error("The browser could not initialize a video encoder for this export.");
      }

      const chunks: BlobPart[] = [];
      let timer: number | undefined;
      const result = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event: BlobEvent): void => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = (): void => reject(new Error("The browser interrupted the video capture."));
        recorder.onstop = (): void => {
          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size < 256) reject(new Error("The captured stage did not contain a usable video stream."));
          else resolve(blob);
        };
        recorder.start(1000);
        const started = performance.now();
        const update = (): void => {
          const elapsed = (performance.now() - started) / 1000;
          const captureProgress = Math.min(1, elapsed / settings.duration);
          onProgress(Math.round(captureProgress * 78), `Capturing frame ${Math.min(settings.duration, elapsed).toFixed(1)} / ${settings.duration.toFixed(1)} sec`);
          if (captureProgress < 1) timer = window.setTimeout(update, 180);
          else if (recorder.state !== "inactive") recorder.stop();
        };
        timer = window.setTimeout(update, 120);
      });

      try {
        const blob = await result;
        onProgress(82, "Uploading capture to the render engine…");
        return blob;
      } finally {
        if (timer) window.clearTimeout(timer);
        if (recorder.state !== "inactive") recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        onProgress(86, "Restoring preview…");
      }
    },
  }), []);

  return (
    <div className="canvas-shell">
      <canvas ref={canvasRef} className="preview-canvas" aria-label="Animated motion preview" />
      {!props.imageUrl && (
        <div className="empty-canvas-copy" aria-hidden="true">
          <div className="empty-canvas-kicker"><Sparkles size={12} /> CREATIVE STAGE</div>
          <div className="empty-canvas-title">Give your image<br /><em>a little momentum.</em></div>
          <span>Upload a reference to start shaping motion.</span>
        </div>
      )}
      {props.imageUrl && (
        <div className="canvas-image-label"><span className="canvas-label-icon"><Sparkles size={11} /></span>{props.imageName || "Reference image"}</div>
      )}
      <button className="canvas-expand-button" type="button" aria-label="Canvas preview fills available area" title="Preview stage"><Maximize2 size={14} /></button>
      <div className="canvas-corner canvas-corner-tl" aria-hidden="true" />
      <div className="canvas-corner canvas-corner-br" aria-hidden="true" />
    </div>
  );
});

function drawAbstractArtwork(context: CanvasRenderingContext2D, width: number, height: number, time: number, state: SceneState): void {
  const centerX = width * (0.5 + Math.sin(time * 0.12) * 0.025);
  const centerY = height * (0.49 + Math.cos(time * 0.1) * 0.02);
  const radius = Math.min(width, height) * 0.28;
  const ringCount = state.mode === "3d" ? 7 : 5;

  for (let index = ringCount - 1; index >= 0; index -= 1) {
    const phase = time * (0.2 + index * 0.009) + index * 0.65;
    const ringRadius = radius * (0.5 + index * 0.15 + Math.sin(phase) * 0.017);
    context.beginPath();
    context.ellipse(centerX, centerY, ringRadius * (1.35 + Math.sin(phase) * 0.07), ringRadius * (0.55 + index * 0.045), phase * 0.16, 0, Math.PI * 2);
    context.strokeStyle = rgba(index % 2 === 0 ? state.preset.palette.accent : state.preset.palette.highlight, 0.12 + (ringCount - index) * 0.016);
    context.lineWidth = Math.max(1, width * 0.0008);
    context.stroke();
  }

  const orbX = centerX + Math.sin(time * 0.24) * radius * 0.6;
  const orbY = centerY + Math.cos(time * 0.2) * radius * 0.28;
  const orbRadius = radius * (0.45 + Math.sin(time * 0.28) * 0.02);
  const orb = context.createRadialGradient(orbX - orbRadius * 0.3, orbY - orbRadius * 0.34, orbRadius * 0.04, orbX, orbY, orbRadius);
  orb.addColorStop(0, rgba(state.preset.palette.highlight, 0.96));
  orb.addColorStop(0.26, rgba(state.preset.palette.accent, 0.75));
  orb.addColorStop(0.72, rgba(state.preset.palette.secondary, 0.28));
  orb.addColorStop(1, rgba(state.preset.palette.base, 0.04));
  context.beginPath();
  context.arc(orbX, orbY, orbRadius, 0, Math.PI * 2);
  context.fillStyle = orb;
  context.fill();

  context.globalCompositeOperation = "screen";
  context.beginPath();
  context.ellipse(centerX, centerY, radius * 1.6, radius * 0.34, -0.24 + Math.sin(time * 0.14) * 0.04, 0, Math.PI * 2);
  context.strokeStyle = rgba(state.preset.palette.highlight, 0.36);
  context.lineWidth = Math.max(2, width * 0.0035);
  context.shadowColor = state.preset.palette.accent;
  context.shadowBlur = width * 0.02;
  context.stroke();
  context.shadowBlur = 0;
  context.globalCompositeOperation = "source-over";
}

function drawParticles(context: CanvasRenderingContext2D, width: number, height: number, time: number, state: SceneState, particles: Particle[]): void {
  const scale = Math.max(0.35, state.particleScale);
  const colorList = [state.preset.palette.accent, state.preset.palette.highlight, state.preset.palette.secondary];
  context.save();
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    const theta = time * particle.speed + particle.phase;
    const x = ((particle.x + Math.sin(theta) * particle.drift + 1) % 1) * width;
    const y = ((particle.y + Math.cos(theta * 0.76) * particle.drift + time * particle.speed * 0.012 + 1) % 1) * height;
    const radius = Math.max(1, particle.size * Math.min(width, height) * scale);
    const twinkle = 0.54 + Math.sin(theta * 1.7) * 0.28;
    const color = colorList[index % colorList.length];
    const glow = context.createRadialGradient(x, y, 0, x, y, radius * 4.2);
    glow.addColorStop(0, rgba(color, particle.alpha * twinkle));
    glow.addColorStop(1, rgba(color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, radius * 4.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = rgba(color, particle.alpha * twinkle * 0.8);
    context.beginPath();
    context.arc(x, y, radius * 0.75, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawAmbientLines(context: CanvasRenderingContext2D, width: number, height: number, time: number, state: SceneState): void {
  const offset = ((time * 12) % height) / height;
  const opacity = state.mode === "line-art" ? 0.045 : 0.018;
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = state.preset.palette.highlight;
  context.lineWidth = Math.max(1, width * 0.0004);
  for (let index = -1; index < 8; index += 1) {
    const y = (index / 7 + offset * 0.08) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y - height * 0.08);
    context.stroke();
  }
  context.restore();
}

export default StudioCanvas;
