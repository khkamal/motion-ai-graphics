"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  Gauge,
  Image as ImageIcon,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MoveHorizontal,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import ApiKeyManager from "@/components/ApiKeyManager";
import ImageUploader, { type UploadedReference } from "@/components/ImageUploader";
import RenderModal, { type RenderSettings } from "@/components/RenderModal";
import Sidebar from "@/components/Sidebar";
import StudioCanvas, { type StudioCanvasHandle } from "@/components/StudioCanvas";
import { presetById, studioPresets, type BackgroundMode, type MotionMode, type MotionPattern, type StudioPreset } from "@/lib/presets";
import {
  applyBrowserApiKeyUpdates,
  readBrowserApiKeys,
  readBrowserRotationCursor,
  readRecentStyleSignatures,
  rememberStyleSignature,
  writeBrowserRotationCursor,
  type BrowserApiKeyUpdate,
} from "@/lib/browserKeyStore";

type NoticeTone = "success" | "warning" | "error";
type DynamicStyle = {
  palette: string;
  camera: string;
  lighting: string;
  particles: string;
  texture: string;
  rhythm: string;
  phaseDegrees: number;
  orbitDegrees: number;
  particleDensity: number;
  easing: string;
};
type GenerationPayload = {
  generationId: string;
  seed: string;
  styleSignature: string;
  style: DynamicStyle;
  prompt: string;
  aiEnhanced: boolean;
  notice: string | null;
  keyUpdates: BrowserApiKeyUpdate[];
  rotationCursor: number;
};

const modes: Array<{ id: MotionMode; label: string; short: string; icon: typeof Layers3 }> = [
  { id: "2d", label: "2D motion", short: "2D", icon: Layers3 },
  { id: "3d", label: "3D depth", short: "3D", icon: MoveHorizontal },
  { id: "line-art", label: "Line art", short: "Line", icon: AudioLines },
];
const speedOptions = [0.25, 1, 2, 3];
const LOCAL_DRAFT_KEY = "motion-ai-studio:draft:v1";
const backgroundModes: BackgroundMode[] = ["original", "transparent", "green", "blue", "custom"];

function isDynamicStyle(value: unknown): value is DynamicStyle {
  if (!value || typeof value !== "object") return false;
  const style = value as Record<string, unknown>;
  return ["palette", "camera", "lighting", "particles", "texture", "rhythm", "easing"].every((key) => typeof style[key] === "string") &&
    ["phaseDegrees", "orbitDegrees", "particleDensity"].every((key) => typeof style[key] === "number" && Number.isFinite(style[key]));
}

function createClientSeed(): string {
  const bytes = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const sample = new Uint32Array(1);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) window.crypto.getRandomValues(sample);
  else sample[0] = Math.floor(Math.random() * 0xffffffff);
  return sample[0] % length;
}

function safeFilenameFromHeader(header: string | null, format: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  const name = match?.[1]?.replace(/[\\/\r\n]/g, "");
  return name || `motion-ai-studio.${format}`;
}

function parseVideoKeyUpdates(header: string | null): BrowserApiKeyUpdate[] {
  if (!header) return [];
  try {
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload: unknown = JSON.parse(window.atob(padded));
    if (!Array.isArray(payload)) return [];
    return payload.filter((value): value is BrowserApiKeyUpdate => {
      if (!value || typeof value !== "object") return false;
      const update = value as Record<string, unknown>;
      return typeof update.id === "string" &&
        ["ACTIVE", "COOLDOWN", "INVALID"].includes(String(update.status)) &&
        typeof update.failureCount === "number" &&
        (update.cooldownUntil === null || typeof update.cooldownUntil === "string") &&
        (update.lastUsedAt === null || typeof update.lastUsedAt === "string");
    });
  } catch {
    return [];
  }
}

function readableTimelineMark(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const whole = Math.floor(safeSeconds);
  const tenth = Math.round((safeSeconds - whole) * 10);
  return `00:${String(whole).padStart(2, "0")}${tenth > 0 ? `.${tenth}` : ""}`;
}

function getParticleScale(value: string): number {
  const match = value.match(/(?:scale|size)\s+(?:the\s+)?particles?\s+(up|down)?\s*(?:by\s*)?(\d+(?:\.\d+)?)\s*%/i);
  if (!match) return 1;
  const amount = Math.min(200, Number(match[2])) / 100;
  return Math.max(0.2, Math.min(3, match[1]?.toLowerCase() === "down" ? 1 - amount : 1 + amount));
}

function readableTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `00:${String(Math.floor(wholeSeconds / 60)).padStart(2, "0")}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function motionPatternForCamera(camera: string, seedNumber: number): MotionPattern {
  const direction = camera.toLowerCase();
  if (/orbit|arc|spiral/.test(direction)) return "orbit";
  if (/push-in|dolly-back|macro|focal pull/.test(direction)) return "pulse";
  if (/parallax|depth|foreground/.test(direction)) return "drift";
  if (/crane|rising|rise/.test(direction)) return "ribbon";
  if (/lateral|glide|track|sweep/.test(direction)) return "glide";
  if (/near-static|breathing-axis/.test(direction)) return "bloom";
  if (/focus|tilt/.test(direction)) return "ripple";
  return studioPresets[seedNumber % studioPresets.length].motion;
}

function buildVariationPreset(base: StudioPreset, seed: string, style: DynamicStyle | null): StudioPreset {
  if (!style || !seed) return base;
  const seedNumber = Number.parseInt(seed.slice(0, 8), 16) || 1;
  const theme = studioPresets[seedNumber % studioPresets.length];
  return {
    ...base,
    palette: {
      base: base.palette.base,
      accent: theme.palette.accent,
      highlight: theme.palette.highlight,
      secondary: theme.palette.secondary,
    },
    motion: motionPatternForCamera(style.camera, seedNumber),
    motionProfile: {
      camera: style.camera,
      lighting: style.lighting,
      rhythm: style.rhythm,
      easing: style.easing,
      phaseDegrees: style.phaseDegrees,
      orbitDegrees: style.orbitDegrees,
    },
    particle: style.particles,
    layout: style.camera,
    intensity: Math.max(0.62, Math.min(1, style.orbitDegrees / 40)),
    particleCount: Math.max(28, Math.min(110, Math.round(style.particleDensity))),
  };
}

export default function StudioWorkspace({ renderEngineAvailable }: { renderEngineAvailable: boolean }) {
  const [image, setImage] = useState<UploadedReference | null>(null);
  const [mode, setMode] = useState<MotionMode>("2d");
  const [presetId, setPresetId] = useState(studioPresets[0].id);
  const [basePrompt, setBasePrompt] = useState("Let the image breathe. Add gentle depth, tactile light, and a restrained camera move.");
  const [modifier, setModifier] = useState("");
  const [dynamicStyle, setDynamicStyle] = useState<DynamicStyle | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [seed, setSeed] = useState("stage-preview-motion-seed");
  const [aiEnhanced, setAiEnhanced] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationNotice, setGenerationNotice] = useState("");
  const [generatedVideo, setGeneratedVideo] = useState<Blob | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [generatedVideoDuration, setGeneratedVideoDuration] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [playhead, setPlayhead] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("original");
  const [customBackground, setCustomBackground] = useState("#18212a");
  const [isRenderOpen, setIsRenderOpen] = useState(false);
  const [keyModalVersion, setKeyModalVersion] = useState(0);
  const [browseVersion, setBrowseVersion] = useState(0);
  const [keyCount, setKeyCount] = useState(0);
  const [notice, setNotice] = useState<{ message: string; tone: NoticeTone } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const canvasRef = useRef<StudioCanvasHandle>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRequestIdRef = useRef(0);

  const selectedPreset = useMemo(() => presetById(presetId), [presetId]);
  const visualPreset = useMemo(() => buildVariationPreset(selectedPreset, seed, dynamicStyle), [selectedPreset, seed, dynamicStyle]);
  const particleScale = useMemo(() => getParticleScale(modifier), [modifier]);
  const timelineDuration = generatedVideoUrl && generatedVideoDuration > 0 ? generatedVideoDuration : 10;
  const onKeyCountChange = useCallback((count: number) => setKeyCount(count), []);
  const onVideoDurationChange = useCallback((duration: number): void => {
    setGeneratedVideoDuration((current) => Math.abs(current - duration) < 0.05 ? current : duration);
  }, []);
  const onVideoTimeChange = useCallback((time: number): void => setPlayhead(time), []);

  const showNotice = useCallback((message: string, tone: NoticeTone = "success"): void => {
    setNotice({ message, tone });
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4_800);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    generationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!generatedVideo) {
      setGeneratedVideoUrl(null);
      setGeneratedVideoDuration(0);
      return;
    }
    const videoUrl = URL.createObjectURL(generatedVideo);
    setGeneratedVideoUrl(videoUrl);
    return () => URL.revokeObjectURL(videoUrl);
  }, [generatedVideo]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_DRAFT_KEY);
      if (stored) {
        const draft = JSON.parse(stored) as Record<string, unknown>;
        if (typeof draft.basePrompt === "string") setBasePrompt(draft.basePrompt.slice(0, 1_200));
        if (typeof draft.modifier === "string") setModifier(draft.modifier.slice(0, 600));
        if (modes.some((option) => option.id === draft.mode)) setMode(draft.mode as MotionMode);
        if (studioPresets.some((preset) => preset.id === draft.presetId)) setPresetId(draft.presetId as string);
        if (speedOptions.includes(draft.speed as number)) setSpeed(draft.speed as number);
        if (backgroundModes.includes(draft.backgroundMode as BackgroundMode)) setBackgroundMode(draft.backgroundMode as BackgroundMode);
        if (typeof draft.customBackground === "string" && /^#[0-9a-f]{6}$/i.test(draft.customBackground)) setCustomBackground(draft.customBackground);
        if (typeof draft.seed === "string" && /^[a-f0-9]{32}$/i.test(draft.seed)) setSeed(draft.seed);
        if (typeof draft.generatedPrompt === "string") setGeneratedPrompt(draft.generatedPrompt.slice(0, 4_000));
        if (typeof draft.aiEnhanced === "boolean") setAiEnhanced(draft.aiEnhanced);
        if (isDynamicStyle(draft.dynamicStyle)) setDynamicStyle(draft.dynamicStyle);
      }
    } catch {
      try {
        window.localStorage.removeItem(LOCAL_DRAFT_KEY);
      } catch {
        setGeneratedPrompt("");
      }
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({
        basePrompt,
        modifier,
        mode,
        presetId,
        speed,
        backgroundMode,
        customBackground,
        seed,
        generatedPrompt,
        aiEnhanced,
        dynamicStyle,
      }));
    } catch {
      showNotice("This browser could not save the local motion draft.", "warning");
    }
  }, [draftReady, basePrompt, modifier, mode, presetId, speed, backgroundMode, customBackground, seed, generatedPrompt, aiEnhanced, dynamicStyle, showNotice]);

  useEffect(() => {
    if (!playing || generatedVideoUrl) return;
    const interval = window.setInterval(() => {
      setPlayhead((current) => {
        const next = current + 0.1 * speed;
        return next >= 10 ? next % 10 : next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [playing, speed, generatedVideoUrl]);

  const randomizePreset = useCallback((): void => {
    const candidates = studioPresets.filter((preset) => preset.id !== presetId);
    const next = candidates[randomIndex(candidates.length)] ?? studioPresets[0];
    setPresetId(next.id);
    setDynamicStyle(null);
    setGeneratedPrompt("");
    setGenerationNotice("");
    setSeed(createClientSeed());
    showNotice(`${next.name} · new layout, palette and particle behavior`);
  }, [presetId, showNotice]);

  const generateMotion = async (): Promise<void> => {
    if (!image) {
      showNotice("Add a reference image before generating an AI video.", "warning");
      return;
    }
    const browserKeys = readBrowserApiKeys();
    if (browserKeys.length === 0) {
      const message = "Add a Gemini API key in Settings. Gemini Omni Flash video generation may require a billing-enabled project.";
      setGenerationError(message);
      showNotice(message, "warning");
      return;
    }

    generationAbortRef.current?.abort();
    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    const requestId = generationRequestIdRef.current + 1;
    generationRequestIdRef.current = requestId;
    setIsGenerating(true);
    setGenerationProgress("Analyzing your image and preparing a motion brief…");
    setGenerationError("");
    setGenerationNotice("");
    try {
      const promptResponse = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: image.analysisImage,
          basePrompt,
          modifier,
          mode,
          presetName: selectedPreset.name,
          keys: browserKeys,
          rotationCursor: readBrowserRotationCursor(),
          recentSignatures: readRecentStyleSignatures(),
        }),
        signal: abortController.signal,
      });
      const payload = await promptResponse.json() as GenerationPayload & { error?: string; details?: unknown };
      if (requestId !== generationRequestIdRef.current) return;
      if (!promptResponse.ok) throw new Error(payload.error || "The image-aware motion brief could not be prepared.");

      const keysAfterPrompt = applyBrowserApiKeyUpdates(payload.keyUpdates ?? []);
      const rotationCursor = payload.rotationCursor ?? readBrowserRotationCursor();
      writeBrowserRotationCursor(rotationCursor);
      rememberStyleSignature(payload.styleSignature);
      setSeed(payload.seed);
      setDynamicStyle(payload.style);
      setGeneratedPrompt(payload.prompt);
      setAiEnhanced(payload.aiEnhanced);
      setGenerationProgress("Gemini Omni Flash is generating the video. This can take a few minutes; keep this tab open…");

      const videoResponse = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: image.analysisImage,
          prompt: payload.prompt,
          mode,
          presetName: selectedPreset.name,
          backgroundMode,
          customBackground,
          keys: keysAfterPrompt,
          rotationCursor,
        }),
        signal: abortController.signal,
      });
      if (requestId !== generationRequestIdRef.current) return;
      const headerUpdates = parseVideoKeyUpdates(videoResponse.headers.get("x-gemini-key-updates"));
      const errorPayload = videoResponse.ok
        ? null
        : await videoResponse.json().catch(() => null) as { error?: string; keyUpdates?: BrowserApiKeyUpdate[]; rotationCursor?: number } | null;
      const responseUpdates = errorPayload?.keyUpdates?.length ? errorPayload.keyUpdates : headerUpdates;
      if (responseUpdates.length > 0) applyBrowserApiKeyUpdates(responseUpdates);
      const responseCursor = Number(videoResponse.headers.get("x-gemini-rotation-cursor") ?? errorPayload?.rotationCursor);
      if (Number.isSafeInteger(responseCursor) && responseCursor >= 0) writeBrowserRotationCursor(responseCursor);
      if (!videoResponse.ok) {
        throw new Error(errorPayload?.error || "Gemini Omni Flash could not generate the video. No procedural fallback was used.");
      }
      if (!videoResponse.headers.get("content-type")?.toLowerCase().startsWith("video/mp4")) {
        throw new Error("The video-generation service returned an unsupported file. No procedural fallback was used.");
      }

      const video = await videoResponse.blob();
      if (requestId !== generationRequestIdRef.current) return;
      if (video.size < 256) throw new Error("Gemini returned an empty video file. No procedural fallback was used.");
      setGeneratedVideoDuration(0);
      setGeneratedVideo(video);
      setPlayhead(0);
      setSeekRevision((revision) => revision + 1);
      setPlaying(true);
      setGenerationNotice(`${payload.aiEnhanced ? "Gemini-refined motion brief" : "Local motion brief"} · real AI video rendered by Gemini Omni Flash at 1080p. The result is held in this tab, not saved by Motion AI Studio.`);
      setGenerationProgress("");
      showNotice("Gemini Omni Flash generated a real AI video.");
    } catch (caught) {
      if (requestId !== generationRequestIdRef.current || abortController.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : "Gemini Omni Flash could not generate the video.";
      setGenerationProgress("");
      setGenerationError(message);
      setGenerationNotice("");
      showNotice(message, "error");
    } finally {
      if (requestId === generationRequestIdRef.current) {
        setIsGenerating(false);
        setGenerationProgress("");
        if (generationAbortRef.current === abortController) generationAbortRef.current = null;
      }
    }
  };

  const exportVideo = async (
    settings: RenderSettings,
    onProgress: (value: number, label?: string) => void,
  ): Promise<void> => {
    if (!image) throw new Error("Upload a reference image before exporting a motion sequence.");
    let capture: Blob;
    if (generatedVideo) {
      onProgress(82, "Preparing your Gemini-generated AI video…");
      capture = generatedVideo;
    } else {
      if (!canvasRef.current) throw new Error("The motion stage is not ready to capture.");
      capture = await canvasRef.current.record(settings, onProgress);
    }
    const form = new FormData();
    form.set("video", capture, `motion-stage.${capture.type.includes("mp4") ? "mp4" : "webm"}`);
    form.set("options", JSON.stringify(settings));
    onProgress(88, "Encoding final 30 FPS master with FFmpeg…");

    let response: Response;
    try {
      response = await fetch("/api/render", { method: "POST", body: form });
    } catch {
      throw new Error("The render server could not be reached. Check your connection and try again.");
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "The render could not be completed." })) as { error?: string };
      throw new Error(payload.error || "The render could not be completed.");
    }

    onProgress(96, "Preparing download…");
    const video = await response.blob();
    if (!video.size) throw new Error("The render engine returned an empty file.");
    const filename = safeFilenameFromHeader(response.headers.get("content-disposition"), settings.format);
    const url = URL.createObjectURL(video);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    onProgress(100, "Your video has been downloaded");
    showNotice(`${settings.resolution === "4k" ? "4K UHD" : "1080p"} ${settings.format.toUpperCase()} downloaded successfully.`);
  };

  const copyGeneratedPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      showNotice("Motion direction copied to clipboard.");
    } catch {
      showNotice("Clipboard access is blocked by this browser.", "warning");
    }
  };

  const handleScrub = (value: number): void => {
    setPlayhead(value);
    setSeekRevision((revision) => revision + 1);
  };

  const togglePlay = (): void => {
    if (!playing && playhead >= timelineDuration - 0.1) {
      setPlayhead(0);
      setSeekRevision((revision) => revision + 1);
    }
    setPlaying((current) => !current);
  };

  return (
    <div className="studio-app-shell">
      <Sidebar
        onUploadClick={() => setBrowseVersion((version) => version + 1)}
        onRandomize={randomizePreset}
        onSettingsClick={() => setKeyModalVersion((version) => version + 1)}
      />
      <div className="studio-main">
        <header className="studio-topbar">
          <div className="topbar-title-group">
            <div className="breadcrumb"><span>WORKSPACE</span><span className="breadcrumb-slash">/</span><strong>MOTION LAB</strong></div>
            <div className="project-title-line">
              <h1>Untitled motion</h1>
              <span className="project-unsaved-dot" title="Autosaved locally" />
              <span className="project-save-status">Draft autosaved locally</span>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="engine-status"><span className={`status-dot ${renderEngineAvailable ? "" : "status-dot-warning"}`} /><span>{renderEngineAvailable ? "Render engine ready" : "FFmpeg setup needed"}</span></div>
            <ApiKeyManager onKeyCountChange={onKeyCountChange} openVersion={keyModalVersion} />
            <span className="topbar-divider" />
            <button className="button button-primary top-export-button" type="button" onClick={() => setIsRenderOpen(true)} disabled={!image || !renderEngineAvailable || isGenerating}>
              <Download size={15} /> Export
              <span className="export-shortcut">↗</span>
            </button>
          </div>
        </header>

        <main className="workspace-content">
          <div className="workspace-kicker-row">
            <div>
              <span className="eyebrow">IMAGE TO MOTION</span>
              <h2>Shape a still into a story.</h2>
            </div>
            <div className="workspace-project-meta"><span className="meta-dot" /> 16:9 <span className="meta-divider" /> Draft 01</div>
          </div>

          <div className="studio-grid">
            <aside className="editor-column">
              <div className="panel-section source-section">
                <div className="section-heading">
                  <div className="section-index">01</div>
                  <div><span className="eyebrow">YOUR SOURCE</span><h3>Reference image</h3></div>
                  <button className="subtle-icon-button" type="button" onClick={() => setBrowseVersion((version) => version + 1)} aria-label="Choose an image"><ImageIcon size={15} /></button>
                </div>
                <ImageUploader
                  value={image}
                  onChange={(nextImage) => {
                    generationAbortRef.current?.abort();
                    generationAbortRef.current = null;
                    generationRequestIdRef.current += 1;
                    setIsGenerating(false);
                    setGenerationProgress("");
                    setGenerationError("");
                    setGenerationNotice("");
                    setGeneratedPrompt("");
                    setDynamicStyle(null);
                    setAiEnhanced(false);
                    setGeneratedVideo(null);
                    setImage(nextImage);
                  }}
                  browseVersion={browseVersion}
                />
              </div>

              <div className="panel-divider" />

              <div className="panel-section prompt-section">
                <div className="section-heading">
                  <div className="section-index">02</div>
                  <div><span className="eyebrow">CREATIVE DIRECTION</span><h3>Describe the motion</h3></div>
                  <span className="prompt-ai-icon"><Sparkles size={14} /></span>
                </div>
                <textarea
                  className="prompt-input"
                  value={basePrompt}
                  onChange={(event) => { setBasePrompt(event.target.value); setGeneratedPrompt(""); }}
                  maxLength={1_200}
                  aria-label="Creative direction for the motion"
                />
                <div className="prompt-helper"><Sparkles size={12} /><span>Gemini refines the image-aware brief, then renders real AI video.</span></div>

                <div className="mode-select-label"><span className="field-label">MOTION MODE</span><span className="mode-hint">Choose a visual language</span></div>
                <div className="mode-options" role="group" aria-label="Motion mode">
                  {modes.map(({ id, label, short, icon: Icon }) => (
                    <button key={id} className={`mode-option ${mode === id ? "selected" : ""}`} type="button" onClick={() => { setMode(id); setGeneratedPrompt(""); }} aria-pressed={mode === id} title={label}>
                      <Icon size={15} /><span>{short}</span>
                    </button>
                  ))}
                </div>

                <button className="generate-button" type="button" onClick={() => void generateMotion()} disabled={isGenerating || !image}>
                  {isGenerating ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}
                  <span>{isGenerating ? generationProgress.startsWith("Gemini Omni Flash") ? "Generating AI video…" : "Analyzing image…" : "Generate real AI video"}</span>
                  {!isGenerating && <span className="generate-arrow">↗</span>}
                </button>
                <div className="generate-footnote"><LockKeyhole size={11} /><span>Each pass gets a fresh cryptographic seed</span></div>
                <div className="generation-privacy-note"><Info size={12} /><span>Google processes the image; Omni video access may require billing. Interaction storage is disabled. Motion AI Studio keeps the MP4 only in this tab, while Google may temporarily host it for delivery.</span></div>
                {generationProgress && <div className="generation-progress" role="status"><LoaderCircle className="spin" size={13} /><span>{generationProgress}</span></div>}
                {generationError && <div className="generation-inline-error" role="alert"><Info size={13} /><span>{generationError}</span></div>}
              </div>

              {generatedPrompt && (
                <div className="generated-brief-card">
                  <div className="generated-brief-heading">
                    <div><span className="eyebrow">MOTION BRIEF</span><span className={`ai-result-pill ${aiEnhanced ? "ai-result-live" : ""}`}>{aiEnhanced ? <BadgeCheck size={11} /> : <Sparkles size={11} />}{aiEnhanced ? "Gemini refined" : "Local variation"}</span></div>
                    <button className="subtle-icon-button" type="button" onClick={() => void copyGeneratedPrompt()} aria-label="Copy generated motion brief"><Copy size={13} /></button>
                  </div>
                  <p>{generatedPrompt}</p>
                  {generationNotice && <span className="generation-notice">{generationNotice}</span>}
                </div>
              )}
            </aside>

            <section className="preview-column" aria-label="Motion preview">
              <div className="preview-panel-heading">
                <div className="preview-panel-title"><span className="preview-live-dot" /><div><span className="eyebrow">{generatedVideoUrl ? "AI VIDEO PREVIEW" : "LIVE PREVIEW"}</span><strong>{generatedVideoUrl ? "Gemini Omni Flash" : image ? "Motion stage" : "Atmosphere study"}</strong></div></div>
                <div className="preview-heading-actions">
                  <div className="preview-resolution-tag">{generatedVideoUrl ? "AI 1080p" : <>1920 <span>×</span> 1080</>}</div>
                  <span className="preview-heading-separator" />
                  <button className="icon-button preview-restart-button" type="button" onClick={() => { setPlayhead(0); setSeekRevision((revision) => revision + 1); setPlaying(true); }} aria-label="Restart preview" title="Restart preview"><RotateCcw size={14} /></button>
                </div>
              </div>

              <StudioCanvas
                ref={canvasRef}
                imageUrl={image?.src ?? null}
                imageName={image?.fileName}
                videoUrl={generatedVideoUrl}
                onVideoDurationChange={onVideoDurationChange}
                onVideoTimeChange={onVideoTimeChange}
                mode={mode}
                preset={visualPreset}
                seed={seed}
                speed={speed}
                playing={playing}
                backgroundMode={backgroundMode}
                customBackground={customBackground}
                particleScale={particleScale}
                seekTime={playhead}
                seekRevision={seekRevision}
              />

              <div className="timeline-panel">
                <div className="timeline-controls">
                  <button className="transport-button" type="button" onClick={togglePlay} aria-label={playing ? "Pause preview" : "Play preview"}>
                    {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                  </button>
                  <span className="time-readout">{readableTime(Math.min(playhead, timelineDuration))}<span> / </span>{readableTime(timelineDuration)}</span>
                  <div className="timeline-track-wrap">
                    <div className="timeline-ruler">{[0, 0.25, 0.5, 0.75, 1].map((point) => <span key={point}>{readableTimelineMark(timelineDuration * point)}</span>)}</div>
                    <div className="timeline-track"><div className="timeline-progress" style={{ width: `${Math.min(100, (playhead / timelineDuration) * 100)}%` }} /><span className="timeline-playhead" style={{ left: `${Math.min(100, (playhead / timelineDuration) * 100)}%` }} /></div>
                    <input className="timeline-range" type="range" min={0} max={timelineDuration} step={0.01} value={Math.min(playhead, timelineDuration)} onChange={(event) => handleScrub(Number(event.target.value))} aria-label="Scrub the motion preview" />
                  </div>
                  <label className="speed-select-wrap" aria-label="Playback speed">
                    <Gauge size={14} />
                    <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                      {speedOptions.map((option) => <option key={option} value={option}>{option}x</option>)}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                  <button className="icon-button timeline-settings-button" type="button" onClick={() => setIsRenderOpen(true)} disabled={!image || !renderEngineAvailable || isGenerating} aria-label="Open export settings" title="Open export settings"><SlidersHorizontal size={14} /></button>
                </div>
                {generatedVideoUrl
                  ? <>
                    <div className="timeline-caption ai-video-caption"><span><span className="timeline-caption-dot" /> Gemini Omni Flash · AI output</span><span>Baked 1080P <span className="meta-divider" /> {generatedVideoDuration > 0 ? `${generatedVideoDuration.toFixed(1)} SEC` : "LOADING CLIP"}</span></div>
                    <div className="ai-video-baked-note">This clip is baked. Prompt, mode, and preset edits require a new generation; playback speed still affects preview.</div>
                  </>
                  : <div className="timeline-caption"><span><span className="timeline-caption-dot" /> {visualPreset.name}</span><span>{mode === "line-art" ? "LINE ART" : mode.toUpperCase()} <span className="meta-divider" /> {visualPreset.layout}</span></div>}
              </div>
            </section>

            <aside className="inspector-column">
              <div className="inspector-heading"><div><span className="eyebrow">03 / MOTION DESIGN</span><h3>Fine tune</h3></div><SlidersHorizontal size={15} /></div>

              <div className="inspector-block preset-block">
                <div className="inspector-label-row"><span className="field-label">ACTIVE PRESET</span><button className="text-button randomize-text-button" type="button" onClick={randomizePreset}><RefreshCw size={12} /> Randomize</button></div>
                <button className="preset-picker" type="button" onClick={randomizePreset} aria-label="Randomize motion preset">
                  <span className="preset-swatch" style={{ background: `linear-gradient(145deg, ${visualPreset.palette.accent}, ${visualPreset.palette.secondary} 55%, ${visualPreset.palette.highlight})` }}><Sparkles size={16} /></span>
                  <span className="preset-picker-copy"><strong>{selectedPreset.name}</strong><small>{selectedPreset.category} <span>·</span> {visualPreset.layout}</small></span>
                  <RefreshCw size={14} className="preset-picker-refresh" />
                </button>
                <div className="preset-pips" aria-label="Available visual presets">
                  {studioPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`preset-pip ${preset.id === presetId ? "selected" : ""}`}
                      style={{ "--pip-color": preset.palette.accent } as React.CSSProperties}
                      onClick={() => { setPresetId(preset.id); setDynamicStyle(null); setGeneratedPrompt(""); setSeed(createClientSeed()); }}
                      aria-label={`Select ${preset.name}`}
                      aria-pressed={preset.id === presetId}
                    />
                  ))}
                </div>
              </div>

              <div className="inspector-separator" />

              <div className="inspector-block speed-block">
                <div className="inspector-label-row"><span className="field-label">PLAYBACK SPEED</span><span className="inspector-note">Preview only</span></div>
                <label className="inspector-select-wrap">
                  <span className="select-leading-icon"><Gauge size={15} /></span>
                  <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                    {speedOptions.map((option) => <option key={option} value={option}>{option === 0.25 ? "Quarter speed" : option === 1 ? "Real time" : `${option}× speed`}</option>)}
                  </select>
                  <ChevronDown size={14} />
                </label>
                <div className="speed-quick-select">
                  {speedOptions.map((option) => <button key={option} type="button" onClick={() => setSpeed(option)} className={speed === option ? "selected" : ""}>{option}×</button>)}
                </div>
              </div>

              <div className="inspector-separator" />

              <div className="inspector-block background-block">
                <div className="inspector-label-row"><span className="field-label">BACKGROUND / KEY</span><button className="help-dot" type="button" aria-label="Background matte help" title="Green and blue options place a clean screen color behind the composition. Transparent preview uses a checkerboard."><CircleHelp size={13} /></button></div>
                <label className="inspector-select-wrap">
                  <span className={`background-color-chip background-${backgroundMode}`} style={backgroundMode === "custom" ? { backgroundColor: customBackground } : undefined} />
                  <select value={backgroundMode} onChange={(event) => setBackgroundMode(event.target.value as BackgroundMode)} aria-label="Choose background or chroma key color">
                    <option value="original">Original atmosphere</option>
                    <option value="transparent">Transparent checker</option>
                    <option value="green">Green screen</option>
                    <option value="blue">Blue screen</option>
                    <option value="custom">Custom color</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
                {backgroundMode === "custom" && <label className="custom-color-row"><span>Matte color</span><input type="color" value={customBackground} onChange={(event) => setCustomBackground(event.target.value)} aria-label="Custom background color" /><strong>{customBackground.toUpperCase()}</strong></label>}
                <div className="chroma-note"><Info size={12} /><span>{generatedVideo ? "AI video is baked and opaque; chroma, transparency, and palette controls do not alter it. Set a matte before generating to include it in the prompt." : "Matte colors are rendered into the stage for downstream keying."}</span></div>
              </div>

              <div className="inspector-separator" />

              <div className="inspector-block modifier-block">
                <div className="inspector-label-row"><span className="field-label">ELEMENT MODIFIER</span><span className="modifier-ai-tag"><Sparkles size={10} /> AI</span></div>
                <textarea
                  className="modifier-input"
                  value={modifier}
                  maxLength={600}
                  onChange={(event) => setModifier(event.target.value)}
                  placeholder="e.g. scale particles up by 30%"
                  aria-label="Natural language element modifier"
                />
                <div className="modifier-helper">Describe a small change to motion or scale.</div>
              </div>

              <div className="inspector-bottom-card">
                <div className="variation-card-top"><span className="variation-orbit"><Sparkles size={14} /></span><span className="variation-status">{generatedPrompt ? "FRESH VARIATION" : "VARIATION ENGINE"}</span><span className="variation-pulse" /></div>
                <strong>{generatedPrompt ? "A new motion signature" : "No two passes alike"}</strong>
                <p>{generatedPrompt ? dynamicStyle?.camera ?? "A new camera path and particle field are active." : "A unique random seed rotates the camera, palette, light and particle rhythm."}</p>
                <div className="variation-seed-row"><span>SEED</span><code>{seed.slice(0, 12).toUpperCase()}</code><button type="button" onClick={() => { navigator.clipboard?.writeText(seed).then(() => showNotice("Variation seed copied."), () => showNotice("Clipboard access is blocked.", "warning")); }} aria-label="Copy variation seed"><Copy size={12} /></button></div>
              </div>

              <button className="inspector-export-button" type="button" onClick={() => setIsRenderOpen(true)} disabled={!image || !renderEngineAvailable || isGenerating}>
                <span><Download size={15} /> Export master</span><span>4K <ChevronDown size={13} /></span>
              </button>
            </aside>
          </div>

          <footer className="workspace-footer">
            <span><span className="footer-ready-dot" /> Motion settings autosave in this browser · re-upload images after refresh</span>
            <span>Built for motion that moves differently <Sparkles size={12} /></span>
          </footer>
        </main>
      </div>

      {notice && (
        <div className={`studio-toast toast-${notice.tone}`} role="status">
          <span className="toast-icon">{notice.tone === "success" ? <Check size={15} /> : notice.tone === "warning" ? <Info size={15} /> : <X size={15} />}</span>
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={13} /></button>
        </div>
      )}

      <RenderModal open={isRenderOpen} onClose={() => setIsRenderOpen(false)} aiVideoAvailable={Boolean(generatedVideo)} onExport={exportVideo} />
      <span className="screen-reader-status" aria-live="polite">{keyCount > 0 ? `${keyCount} Gemini API keys connected` : "Gemini API keys not connected"}</span>
    </div>
  );
}
