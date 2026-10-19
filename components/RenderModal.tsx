"use client";

import { useEffect, useState } from "react";
import { Check, Clapperboard, Download, Film, LoaderCircle, ShieldCheck, X } from "lucide-react";

export type RenderSettings = {
  duration: 5 | 10 | 15 | 30;
  resolution: "4k" | "1080p";
  format: "mp4" | "mov";
  codecSpeed: "slow" | "medium";
  fps: 30;
};

type RenderModalProps = {
  open: boolean;
  onClose: () => void;
  onExport: (settings: RenderSettings, onProgress: (value: number, label?: string) => void) => Promise<void>;
};

const durations: Array<RenderSettings["duration"]> = [5, 10, 15, 30];

export default function RenderModal({ open, onClose, onExport }: RenderModalProps) {
  const [settings, setSettings] = useState<RenderSettings>({ duration: 5, resolution: "4k", format: "mp4", codecSpeed: "medium", fps: 30 });
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("Preparing capture…");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!open) {
      setError("");
      setComplete(false);
      setProgress(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !rendering) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, rendering, onClose]);

  if (!open) return null;

  const change = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]): void => {
    setSettings((current) => ({ ...current, [key]: value }));
    setError("");
    setComplete(false);
  };

  const startExport = async (): Promise<void> => {
    setError("");
    setComplete(false);
    setProgress(0);
    setProgressLabel("Preparing capture…");
    setRendering(true);
    try {
      await onExport(settings, (value, label) => {
        setProgress(Math.min(100, Math.max(0, value)));
        if (label) setProgressLabel(label);
      });
      setProgress(100);
      setProgressLabel("Your video is ready");
      setComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The video render could not be completed.");
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="modal-scrim render-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !rendering) onClose(); }}>
      <section className="render-modal" role="dialog" aria-modal="true" aria-labelledby="render-modal-title">
        <div className="render-modal-topline">
          <div className="modal-heading-row render-heading-row">
            <div className="modal-heading-icon render-modal-icon"><Film size={19} /></div>
            <div>
              <span className="eyebrow">FINAL DELIVERY</span>
              <h2 id="render-modal-title">Render your motion</h2>
              <p>Export a clean, stock-ready master file.</p>
            </div>
          </div>
          <button className="icon-button modal-close" type="button" onClick={onClose} disabled={rendering} aria-label="Close export settings"><X size={17} /></button>
        </div>

        <div className="render-modal-content">
          <div className="render-setting-block">
            <div className="setting-heading"><span className="field-label">DURATION</span><span className="setting-note">seconds</span></div>
            <div className="duration-options">
              {durations.map((duration) => (
                <button key={duration} className={`duration-option ${settings.duration === duration ? "selected" : ""}`} type="button" onClick={() => change("duration", duration)} disabled={rendering}>
                  <strong>{String(duration).padStart(2, "0")}</strong><span>sec</span>
                </button>
              ))}
            </div>
          </div>

          <div className="render-setting-block">
            <div className="setting-heading"><span className="field-label">RESOLUTION</span><span className="setting-note">UHD master</span></div>
            <div className="resolution-options">
              <button className={`resolution-option ${settings.resolution === "4k" ? "selected" : ""}`} type="button" onClick={() => change("resolution", "4k")} disabled={rendering}>
                <span className="resolution-check">{settings.resolution === "4k" && <Check size={11} />}</span>
                <span><strong>4K UHD</strong><small>3840 × 2160</small></span>
                <span className="resolution-tag">STOCK</span>
              </button>
              <button className={`resolution-option ${settings.resolution === "1080p" ? "selected" : ""}`} type="button" onClick={() => change("resolution", "1080p")} disabled={rendering}>
                <span className="resolution-check">{settings.resolution === "1080p" && <Check size={11} />}</span>
                <span><strong>Full HD</strong><small>1920 × 1080</small></span>
                <span className="resolution-tag">FAST</span>
              </button>
            </div>
          </div>

          <div className="render-setting-grid">
            <div className="render-setting-block">
              <div className="setting-heading"><span className="field-label">FORMAT</span></div>
              <div className="format-toggle">
                <button className={settings.format === "mp4" ? "selected" : ""} type="button" onClick={() => change("format", "mp4")} disabled={rendering}><Film size={14} /> MP4</button>
                <button className={settings.format === "mov" ? "selected" : ""} type="button" onClick={() => change("format", "mov")} disabled={rendering}><Clapperboard size={14} /> MOV</button>
              </div>
            </div>
            <div className="render-setting-block">
              <div className="setting-heading"><span className="field-label">ENCODE SPEED</span></div>
              <div className="codec-toggle">
                <button className={settings.codecSpeed === "slow" ? "selected" : ""} type="button" onClick={() => change("codecSpeed", "slow")} disabled={rendering}>Slow <span>quality</span></button>
                <button className={settings.codecSpeed === "medium" ? "selected" : ""} type="button" onClick={() => change("codecSpeed", "medium")} disabled={rendering}>Medium <span>balanced</span></button>
              </div>
            </div>
          </div>

          <div className="render-spec-strip">
            <span><span className="spec-dot" /> 30 FPS</span>
            <span><span className="spec-dot" /> H.264 / yuv420p</span>
            <span><ShieldCheck size={13} /> No watermark</span>
          </div>

          {(rendering || error || complete) && (
            <div className={`render-progress-wrap ${error ? "has-error" : complete ? "is-complete" : ""}`}>
              <div className="render-progress-copy">
                <span>{error || (complete ? "Render complete" : progressLabel)}</span>
                <span>{rendering ? `${Math.round(progress)}%` : complete ? <Download size={14} /> : ""}</span>
              </div>
              {rendering && <div className="render-progress-track"><span style={{ width: `${Math.max(progress, 3)}%` }} /></div>}
            </div>
          )}

          <p className="render-disclaimer">The animation is captured at a device-safe browser resolution, then FFmpeg creates your selected 30 FPS delivery size on the studio server. The transparency checker is flattened in MP4/MOV; choose green or blue for a chroma plate. 4K encoding can take a few minutes.</p>
        </div>

        <div className="render-modal-footer">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={rendering}>{complete ? "Close" : "Cancel"}</button>
          <button className="button button-primary render-start-button" type="button" onClick={() => void startExport()} disabled={rendering}>
            {rendering ? <LoaderCircle className="spin" size={16} /> : complete ? <Check size={16} /> : <Download size={16} />}
            {rendering ? "Rendering…" : complete ? "Rendered" : "Render & download"}
          </button>
        </div>
      </section>
    </div>
  );
}
