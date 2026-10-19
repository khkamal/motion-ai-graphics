import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const configured = process.env.API_KEY_ENCRYPTION_KEY?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("API_KEY_ENCRYPTION_KEY must be configured before storing API keys in production.");
  }
  if (configured && configured.length < 32 && process.env.NODE_ENV === "production") {
    throw new Error("API_KEY_ENCRYPTION_KEY must contain at least 32 characters in production.");
  }
  const material = configured ?? "motion-ai-studio-development-key-encryption-secret";
  return createHash("sha256").update(material, "utf8").digest();
}

export function encryptApiKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptApiKey(encryptedValue: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encryptedValue.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored API key has an unsupported encrypted format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintApiKey(value: string): string {
  return createHmac("sha256", encryptionKey()).update(value, "utf8").digest("hex");
}

export function parseApiKeyInput(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input.flatMap((item) => (typeof item === "string" ? item.split(/[,;\n\r]+/) : []))
    : typeof input === "string"
      ? input.split(/[,;\n\r]+/)
      : [];

  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length > 10) throw new Error("A workspace can store up to 10 Gemini API keys.");
  for (const value of unique) {
    if (value.length < 20 || value.length > 256 || /\s/.test(value)) {
      throw new Error("Each Gemini API key must be 20–256 characters with no spaces.");
    }
  }
  return unique;
}
