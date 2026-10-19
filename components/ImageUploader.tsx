"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileImage, ImagePlus, LoaderCircle, RotateCcw, Trash2, Upload } from "lucide-react";

export type UploadedReference = {
  src: string;
  fileName: string;
  width: number;
  height: number;
  analysisImage: {
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    data: string;
  };
};

type ImageUploaderProps = {
  value: UploadedReference | null;
  onChange: (image: UploadedReference | null) => void;
  browseVersion?: number;
};

const MAX_SOURCE_SIZE = 30 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image conversion returned an invalid result."));
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function prepareReference(file: File): Promise<UploadedReference> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > MAX_SOURCE_SIZE) throw new Error("Images must be 30 MB or smaller.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be decoded. Try exporting it as PNG or JPEG.");
  }

  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image preparation is unavailable in this browser.");
    context.fillStyle = "#11141a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const analysisBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The image could not be prepared for analysis.")), "image/jpeg", 0.88);
    });
    const dataUrl = await blobToDataUrl(analysisBlob);
    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("The image could not be encoded for analysis.");

    return {
      src: URL.createObjectURL(file),
      fileName: file.name,
      width: bitmap.width,
      height: bitmap.height,
      analysisImage: { mimeType: "image/jpeg", data: dataUrl.slice(separator + 1) },
    };
  } finally {
    bitmap.close();
  }
}

export default function ImageUploader({ value, onChange, browseVersion = 0 }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeUrlRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (browseVersion > 0) inputRef.current?.click();
  }, [browseVersion]);

  const releaseCurrentUrl = (): void => {
    if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
    activeUrlRef.current = null;
  };

  useEffect(() => () => {
    if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
  }, []);

  const loadFile = async (file?: File): Promise<void> => {
    if (!file) return;
    setError("");
    setIsPreparing(true);
    try {
      const prepared = await prepareReference(file);
      releaseCurrentUrl();
      activeUrlRef.current = prepared.src;
      onChange(prepared);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The image could not be loaded.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    void loadFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  };

  const removeImage = (): void => {
    releaseCurrentUrl();
    setError("");
    onChange(null);
  };

  return (
    <div className="source-card" id="reference-image">
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileChange}
        aria-label="Choose reference image"
      />
      {value ? (
        <div className="source-loaded">
          <div className="source-thumbnail-wrap">
            <img src={value.src} className="source-thumbnail" alt="Selected reference" />
            <div className="source-image-badge"><FileImage size={13} /> Reference loaded</div>
          </div>
          <div className="source-file-row">
            <span className="source-file-icon"><FileImage size={16} /></span>
            <div className="source-file-copy">
              <strong title={value.fileName}>{value.fileName}</strong>
              <span>{value.width.toLocaleString()} × {value.height.toLocaleString()}</span>
            </div>
            <button className="icon-button small-icon-button" type="button" onClick={() => inputRef.current?.click()} aria-label="Replace image" title="Replace image">
              <RotateCcw size={14} />
            </button>
            <button className="icon-button small-icon-button destructive-icon" type="button" onClick={removeImage} aria-label="Remove image" title="Remove image">
              <Trash2 size={14} />
            </button>
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      ) : (
        <div
          className={`dropzone ${isDragging ? "dropzone-active" : ""} ${isPreparing ? "dropzone-loading" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            const target = event.relatedTarget;
            if (!(target instanceof Node) || !event.currentTarget.contains(target)) setIsDragging(false);
          }}
          onDrop={handleDrop}
          onClick={() => !isPreparing && inputRef.current?.click()}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !isPreparing) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Drop a reference image or choose a file"
        >
          <div className="dropzone-icon">
            {isPreparing ? <LoaderCircle size={20} className="spin" /> : isDragging ? <ImagePlus size={20} /> : <Upload size={19} />}
          </div>
          <div className="dropzone-copy">
            <strong>{isPreparing ? "Preparing image…" : isDragging ? "Drop to add reference" : "Drop an image or browse"}</strong>
            <span>PNG, JPG or WebP · up to 30 MB</span>
          </div>
          <span className="dropzone-action">{isPreparing ? "" : "Choose file"}</span>
        </div>
      )}
      {!value && error && <p className="field-error source-error">{error}</p>}
    </div>
  );
}
