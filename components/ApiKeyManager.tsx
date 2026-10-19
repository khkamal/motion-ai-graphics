"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleHelp, KeyRound, LoaderCircle, LockKeyhole, Plus, ShieldCheck, X } from "lucide-react";
import {
  clearBrowserApiKeys,
  KEY_POOL_UPDATED_EVENT,
  parseBrowserApiKeyInput,
  readBrowserApiKeys,
  saveBrowserApiKeys,
  type BrowserApiKey as StoredKey,
} from "@/lib/browserKeyStore";

type ApiKeyManagerProps = {
  onKeyCountChange?: (count: number) => void;
  openVersion?: number;
};

export default function ApiKeyManager({ onKeyCountChange, openVersion = 0 }: ApiKeyManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadKeys = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const nextKeys = readBrowserApiKeys();
      setKeys(nextKeys);
      onKeyCountChange?.(nextKeys.length);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the local Gemini key pool.");
    } finally {
      setLoading(false);
    }
  }, [onKeyCountChange]);

  useEffect(() => {
    void loadKeys();
    window.addEventListener(KEY_POOL_UPDATED_EVENT, loadKeys);
    window.addEventListener("storage", loadKeys);
    return () => {
      window.removeEventListener(KEY_POOL_UPDATED_EVENT, loadKeys);
      window.removeEventListener("storage", loadKeys);
    };
  }, [loadKeys]);

  useEffect(() => {
    if (openVersion > 0) setIsOpen(true);
  }, [openVersion]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !saving) setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, saving]);

  const saveKeys = async (): Promise<void> => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const values = parseBrowserApiKeyInput(draft);
      const nextKeys = saveBrowserApiKeys(values);
      setKeys(nextKeys);
      onKeyCountChange?.(nextKeys.length);
      setDraft("");
      setNotice("Keys are saved only in this browser and are not stored by the studio server.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Gemini API keys in this browser.");
    } finally {
      setSaving(false);
    }
  };

  const clearKeys = async (): Promise<void> => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      clearBrowserApiKeys();
      setKeys([]);
      onKeyCountChange?.(0);
      setNotice("The Gemini key pool was removed from this browser.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear the local Gemini key pool.");
    } finally {
      setSaving(false);
    }
  };

  const activeCount = keys.filter((key) => key.status === "ACTIVE").length;

  return (
    <>
      <button className="key-pool-trigger" type="button" onClick={() => { setIsOpen(true); setNotice(""); setError(""); }}>
        <KeyRound size={15} />
        <span className="key-trigger-label">Gemini</span>
        <span className={`key-count-pill ${activeCount > 0 ? "key-count-connected" : ""}`}>
          <span className="status-dot" />{loading ? "…" : activeCount ? `${activeCount} ready` : "Connect"}
        </span>
      </button>

      {isOpen && (
        <div className="modal-scrim key-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setIsOpen(false); }}>
          <section className="key-modal" role="dialog" aria-modal="true" aria-labelledby="key-modal-title">
            <div className="modal-heading-row">
              <div className="modal-heading-icon key-modal-icon"><KeyRound size={19} /></div>
              <div>
                <span className="eyebrow">CONNECTIONS</span>
                <h2 id="key-modal-title">Gemini API key pool</h2>
                <p>Keep your image prompts moving when a key reaches its quota.</p>
              </div>
              <button className="icon-button modal-close" type="button" onClick={() => setIsOpen(false)} disabled={saving} aria-label="Close API key settings"><X size={17} /></button>
            </div>

            <div className="key-security-banner">
              <ShieldCheck size={16} />
              <span>Keys stay in this browser&apos;s local storage (not encrypted); generation requests use them transiently and never save them on the server.</span>
              <span className="security-lock"><LockKeyhole size={14} /></span>
            </div>

            <div className="key-modal-body">
              <label className="field-label" htmlFor="gemini-key-input">ADD OR REPLACE KEYS</label>
              <div className="key-input-wrap">
                <KeyRound size={16} />
                <input
                  id="gemini-key-input"
                  type="password"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !saving) void saveKeys(); }}
                  placeholder="AIza… ,AIza… ,AIza…"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-describedby="key-input-help"
                  disabled={saving}
                />
                <button className="icon-button input-add-button" type="button" onClick={() => void saveKeys()} disabled={saving || !draft.trim()} aria-label="Save API keys">
                  {saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                </button>
              </div>
              <p className="field-hint" id="key-input-help">Paste up to 10 Gemini API keys separated by commas. Spaces around commas are trimmed.</p>

              {error && <div className="inline-alert error-alert" role="alert">{error}</div>}
              {notice && <div className="inline-alert success-alert" role="status"><Check size={14} />{notice}</div>}

              <div className="key-list-heading">
                <span className="field-label">SAVED KEYS</span>
                <span className="key-list-total">{keys.length} / 10</span>
              </div>
              <div className="key-list">
                {loading ? (
                  <div className="key-empty-state"><LoaderCircle className="spin" size={16} /> Loading local keys…</div>
                ) : keys.length > 0 ? keys.map((key) => (
                  <div className="saved-key-row" key={key.id}>
                    <span className="saved-key-icon"><KeyRound size={14} /></span>
                    <div className="saved-key-name">
                      <strong>{key.label}</strong>
                      <span>{key.masked}</span>
                    </div>
                    <span className={`key-status status-${key.status.toLowerCase()}`}>
                      <span className="status-dot" />
                      {key.status === "ACTIVE" ? "Ready" : key.status === "COOLDOWN" ? "Cooling" : "Check key"}
                    </span>
                  </div>
                )) : (
                  <div className="key-empty-state"><CircleHelp size={16} /> No Gemini keys connected yet.</div>
                )}
              </div>
            </div>

            <div className="key-modal-footer">
              <button className="text-button clear-keys-button" type="button" onClick={() => void clearKeys()} disabled={saving || keys.length === 0}>
                Clear key pool
              </button>
              <div className="key-modal-footer-actions">
                <button className="button button-secondary" type="button" onClick={() => setIsOpen(false)} disabled={saving}>Done</button>
                <button className="button button-primary" type="button" onClick={() => void saveKeys()} disabled={saving || !draft.trim()}>
                  {saving ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
                  Save key pool
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
