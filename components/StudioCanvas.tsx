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
  videoUrl: string | null;
  onVideoDurationChange: (duration: number) => void;
  onVideoTimeChange: (time: number) => void;
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
  videoUrl: string | null;
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
  const tile = Math.max(16, Math.round(width / 40));
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

type CameraTransform = { x: number; y: number; zoom: number; rotation: number; shearX: number; shearY: number };

function easedWave(cycle: number, easing: string | undefined): number {
  const wave = Math.sin(cycle);
  const style = easing?.toLowerCase() ?? "";
  if (style.includes("spring") || style.includes("elastic")) {
    return Math.max(-1.08, Math.min(1.08, wave + Math.sin(cycle * 2) * 0.08));
  }
  if (style.includes("cubic")) return Math.sign(wave) * Math.pow(Math.abs(wave), 0.82);
  if (style.includes("quintic")) return Math.sign(wave) * Math.pow(Math.abs(wave), 1.28);
  return wave;
}

function getCameraTransform(state: SceneState, time: number, width: number, height: number): CameraTransform {
  const profile = state.preset.motionProfile;
  const phaseDegrees = profile?.phaseDegrees ?? hashString(state.seed) % 360;
  const cycle = (time * Math.PI * 2) / 10 + (phaseDegrees * Math.PI) / 180;
  const wave = easedWave(cycle, profile?.easing);
  const crossWave = easedWave(cycle + Math.PI / 2, profile?.easing);
  const secondWave = easedWave(cycle * 2 + 0.42, profile?.easing);
  const intensity = Math.max(0.45, Math.min(1, state.preset.intensity));
  const arcScale = Math.max(0.65, Math.min(1.15, (profile?.orbitDegrees ?? 24) / 36));
  const xAmplitude = width * (0.035 + intensity * 0.02) * arcScale;
  const yAmplitude = height * (0.018 + intensity * 0.012) * arcScale;
  const rotationAmplitude = 0.018 + intensity * 0.018;
  const zoomRange = 0.028 + intensity * 0.035;
  const transform: CameraTransform = { x: 0, y: 0, zoom: 1.04, rotation: 0, shearX: 0, shearY: 0 };

  switch (state.preset.motion) {
    case "orbit":
      transform.x = wave * xAmplitude;
      transform.y = crossWave * yAmplitude;
      transform.rotation = wave * rotationAmplitude;
      transform.zoom = 1.045 + (0.5 + crossWave * 0.5) * zoomRange;
      break;
    case "drift":
      transform.x = wave * xAmplitude * 1.2;
      transform.y = easedWave(cycle + 0.8, profile?.easing) * yAmplitude;
      transform.rotation = crossWave * rotationAmplitude * 0.35;
      transform.zoom = 1.04 + (0.5 + wave * 0.5) * zoomRange * 0.7;
      break;
    case "pulse":
      transform.x = wave * width * 0.016 * arcScale;
      transform.y = crossWave * height * 0.014 * arcScale;
      transform.rotation = wave * 0.008;
      transform.zoom = 1.035 + (0.5 + wave * 0.5) * zoomRange * 1.4;
      break;
    case "ribbon":
      transform.x = wave * xAmplitude;
      transform.y = secondWave * yAmplitude * 0.8;
      transform.rotation = wave * rotationAmplitude * 0.65;
      transform.shearX = wave * 0.04 * intensity;
      break;
    case "ripple":
      transform.x = wave * xAmplitude * 0.72;
      transform.y = crossWave * yAmplitude;
      transform.zoom = 1.04 + (0.5 + secondWave * 0.5) * zoomRange * 0.9;
      transform.rotation = wave * 0.012;
      break;
    case "glide":
      transform.x = wave * xAmplitude * 1.35;
      transform.y = crossWave * yAmplitude * 0.45;
      transform.rotation = crossWave * rotationAmplitude * 0.4;
      transform.zoom = 1.045 + (0.5 + crossWave * 0.5) * zoomRange * 0.55;
      break;
    case "warp":
      transform.x = wave * xAmplitude;
      transform.y = crossWave * yAmplitude;
      transform.rotation = wave * rotationAmplitude;
      transform.shearX = wave * 0.05 * intensity;
      transform.shearY = crossWave * 0.015 * intensity;
      break;
    case "bloom":
      transform.x = wave * width * 0.015 * arcScale;
      transform.y = crossWave * height * 0.012;
      transform.zoom = 1.045 + (0.5 + wave * 0.5) * zoomRange * 1.3;
      break;
  }

  const rhythm = profile?.rhythm.toLowerCase() ?? "";
  if (/(accent|pulse|beat|accelerat|crescendo)/.test(rhythm)) {
    transform.zoom += Math.max(0, easedWave(cycle * 2 + Math.PI / 2, profile?.easing)) * 0.012 * intensity;
  }
  if (state.mode === "3d") {
    transform.rotation += crossWave * 0.018;
    transform.shearX += crossWave * 0.035;
    transform.shearY += wave * 0.012;
  } else if (state.mode === "line-art") {
    transform.rotation *= 0.72;
  }
  return transform;
}

function drawMotionLighting(context: CanvasRenderingContext2D, width: number, height: number, time: number, state: SceneState): void {
  const profile = state.preset.motionProfile;
  if (!profile || ["green", "blue", "custom"].includes(state.backgroundMode)) return;
  const phase = (profile.phaseDegrees * Math.PI) / 180;
  const cycle = (time * Math.PI * 2) / 10 + phase;
  const x = width * (0.5 + Math.sin(cycle) * 0.4);
  const y = height * (0.5 + Math.cos(cycle + Math.PI / 3) * 0.18);
  const lighting = profile.lighting.toLowerCase();
  const lightColor = /(warm|amber|copper|champagne|coral|dawn)/.test(lighting)
    ? state.preset.palette.secondary
    : /(cool|arctic|cyan|blue|pearl)/.test(lighting)
      ? state.preset.palette.highlight
      : state.preset.palette.accent;
  const radius = Math.max(width, height) * 0.56;
  const sweep = context.createRadialGradient(x, y, 0, x, y, radius);
  sweep.addColorStop(0, rgba(lightColor, 0.13));
  sweep.addColorStop(0.42, rgba(state.preset.palette.highlight, 0.07));
  sweep.addColorStop(1, rgba(state.preset.palette.accent, 0));
  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = state.mode === "line-art" ? 1 : 0.78;
  context.fillStyle = sweep;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: SceneState,
  image: HTMLImageElement | null,
  particles: Particle[],
): void {
  if (!width || !height) return;
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

  if (image && image.complete && image.naturalWidth > 0) {
    const fit = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const camera = getCameraTransform(state, time, width, height);
    const drawWidth = image.naturalWidth * fit;
    const drawHeight = image.naturalHeight * fit;
    context.save();
    context.translate(width / 2 + camera.x, height / 2 + camera.y);
    context.rotate(camera.rotation);
    context.transform(1, camera.shearY, camera.shearX, 1, 0, 0);
    context.scale(camera.zoom, camera.zoom);
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

  drawMotionLighting(context, width, height, time, state);
  drawParticles(context, width, height, time, state, particles);
  drawAmbientLines(context, width, height, time, state);
  context.restore();
}

async function waitForImage(image: HTMLImageElement | null): Promise<void> {
  if (!image) throw new Error("The reference image is still loading. Wait a moment, then export again.");
  if (image.complete) {
    if (image.naturalWidth > 0) return;
    throw new Error("The reference image could not be decoded by this browser.");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The reference image is taking too long to load. Try choosing it again."));
    }, 15_000);
    const cleanup = (): void => {
      window.clearTimeout(timeout);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const onLoad = (): void => {
      cleanup();
      if (image.naturalWidth > 0) resolve();
      else reject(new Error("The reference image could not be decoded by this browser."));
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("The reference image could not be decoded by this browser."));
    };
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    if (image.complete) onLoad();
  });
}

const StudioCanvas = forwardRef<StudioCanvasHandle, StudioCanvasProps>(function StudioCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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
      if (state.videoUrl) return;
      if (!width || !height) {
        frameId = window.requestAnimationFrame(drawFrame);
        return;
      }

      const delta = previousFrameRef.current ? Math.min(0.05, (timestamp - previousFrameRef.current) / 1000) : 0;
      previousFrameRef.current = timestamp;
      if (state.playing) elapsedRef.current += delta * state.speed;
      const time = elapsedRef.current;
      drawScene(context, width, height, time, state, imageRef.current, particlesRef.current);
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
  }, [props.imageUrl, props.videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.videoUrl) return;

    const syncDuration = (): void => {
      if (Number.isFinite(video.duration) && video.duration > 0) props.onVideoDurationChange(video.duration);
    };
    const syncTime = (): void => {
      if (Number.isFinite(video.currentTime)) props.onVideoTimeChange(video.currentTime);
    };
    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("timeupdate", syncTime);
    syncDuration();
    syncTime();
    return () => {
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("timeupdate", syncTime);
    };
  }, [props.videoUrl, props.onVideoDurationChange, props.onVideoTimeChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.videoUrl) return;
    video.playbackRate = Math.max(0.25, Math.min(3, props.speed));
    if (props.playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [props.videoUrl, props.playing, props.speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.videoUrl || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = Math.min(video.duration, Math.max(0, props.seekTime));
    if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
  }, [props.videoUrl, props.seekRevision]);

  useImperativeHandle(ref, () => ({
    async record(settings, onProgress): Promise<Blob> {
      const stage = canvasRef.current;
      if (!stage) throw new Error("The motion stage is not ready to capture.");
      if (typeof MediaRecorder === "undefined") {
        throw new Error("Video capture is not supported in this browser. Use an up-to-date version of Chrome, Edge, or Firefox.");
      }

      const scene = sceneRef.current;
      let sourceImage = imageRef.current;
      if (scene.imageUrl && !sourceImage) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
        sourceImage = imageRef.current;
      }
      if (scene.imageUrl) await waitForImage(sourceImage);

      const isMobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 768;
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      const isLowMemory = typeof deviceMemory === "number" && deviceMemory <= 4;
      const mobileCaptureWidth = settings.resolution === "1080p" || isLowMemory ? 1280 : 1600;
      const width = isMobile ? mobileCaptureWidth : isLowMemory ? 1600 : 1920;
      const height = Math.round((width * 9) / 16);
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = width;
      captureCanvas.height = height;
      const captureContext = captureCanvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!captureContext) throw new Error("This browser could not create a safe-resolution export canvas.");
      if (typeof captureCanvas.captureStream !== "function") {
        throw new Error("Video capture is not supported in this browser. Try a current desktop browser.");
      }

      const mobileTypes = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
      const desktopTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const isTypeSupported = typeof MediaRecorder.isTypeSupported === "function"
        ? (type: string) => MediaRecorder.isTypeSupported(type)
        : (type: string) => type === "video/webm";
      const mimeType = (isMobile ? mobileTypes : desktopTypes).find(isTypeSupported);
      if (!mimeType) throw new Error("This browser cannot record a WebM capture for FFmpeg.");

      const exportState: SceneState = { ...scene, playing: true };
      const exportParticles = createParticles(`${scene.seed}:${scene.preset.id}`, Math.max(26, scene.preset.particleCount));
      const bitrate = width >= 1920 ? 8_000_000 : width >= 1600 ? 6_000_000 : 5_000_000;
      let stream: MediaStream | undefined;
      let recorder: MediaRecorder | undefined;
      let frameId = 0;
      let progressTimer: number | undefined;

      try {
        drawScene(captureContext, width, height, 0, exportState, sourceImage, exportParticles);
        stream = captureCanvas.captureStream(settings.fps);
        if (stream.getVideoTracks().length === 0) throw new Error("The browser did not create a video capture track.");
        try {
          recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
        } catch {
          throw new Error("The browser could not initialize a video encoder. Try exporting at Full HD.");
        }

        const chunks: BlobPart[] = [];
        const captureDuration = settings.duration;
        let started = 0;
        const result = new Promise<Blob>((resolve, reject) => {
          let settled = false;
          const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          recorder!.ondataavailable = (event: BlobEvent): void => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder!.onerror = (): void => fail(new Error("The browser interrupted video capture. Try Full HD or keep the tab open during export."));
          recorder!.onstop = (): void => {
            if (settled) return;
            settled = true;
            const blob = new Blob(chunks, { type: mimeType });
            if (blob.size < 256) {
              reject(new Error("The browser captured no usable video frames. Try Full HD and keep this tab in the foreground."));
            } else {
              resolve(blob);
            }
          };

          try {
            recorder!.start(1000);
            started = performance.now();
            const drawCaptureFrame = (timestamp: number): void => {
              const elapsed = Math.max(0, (timestamp - started) / 1000);
              const sceneTime = Math.min(captureDuration, elapsed) * exportState.speed;
              drawScene(captureContext, width, height, sceneTime, exportState, sourceImage, exportParticles);
              if (elapsed < captureDuration) {
                frameId = window.requestAnimationFrame(drawCaptureFrame);
              } else if (recorder!.state !== "inactive") {
                recorder!.stop();
              }
            };
            frameId = window.requestAnimationFrame(drawCaptureFrame);
            progressTimer = window.setInterval(() => {
              const elapsed = Math.min(captureDuration, Math.max(0, (performance.now() - started) / 1000));
              const captureProgress = elapsed / captureDuration;
              onProgress(Math.round(captureProgress * 78), `Capturing frame ${elapsed.toFixed(1)} / ${captureDuration.toFixed(1)} sec`);
              if (elapsed >= captureDuration && recorder!.state !== "inactive") recorder!.stop();
            }, 180);
          } catch (error) {
            fail(error instanceof Error ? error : new Error("The browser could not start video capture."));
          }
        });

        const blob = await result;
        onProgress(82, "Capture ready; preparing upload…");
        return blob;
      } finally {
        if (frameId) window.cancelAnimationFrame(frameId);
        if (progressTimer !== undefined) window.clearInterval(progressTimer);
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stream?.getTracks().forEach((track) => track.stop());
        captureCanvas.width = 1;
        captureCanvas.height = 1;
      }
    },
  }), []);

  return (
    <div className="canvas-shell">
      <canvas ref={canvasRef} className={`preview-canvas ${props.videoUrl ? "preview-canvas-hidden" : ""}`} aria-label="Animated motion preview" />
      {props.videoUrl && (
        <video
          ref={videoRef}
          className="preview-video"
          src={props.videoUrl}
          autoPlay={props.playing}
          loop
          muted
          playsInline
          preload="metadata"
          aria-label="Gemini-generated video preview"
        />
      )}
      {!props.imageUrl && (
        <div className="empty-canvas-copy" aria-hidden="true">
          <div className="empty-canvas-kicker"><Sparkles size={12} /> CREATIVE STAGE</div>
          <div className="empty-canvas-title">Give your image<br /><em>a little momentum.</em></div>
          <span>Upload a reference to start shaping motion.</span>
        </div>
      )}
      {props.imageUrl && (
        <div className="canvas-image-label"><span className="canvas-label-icon"><Sparkles size={11} /></span>{props.videoUrl ? "Gemini AI-generated video" : props.imageName || "Reference image"}</div>
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
