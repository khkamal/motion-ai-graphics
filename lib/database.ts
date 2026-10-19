import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ApiKeyRecord = {
  id: string;
  workspaceId: string;
  encryptedKey: string;
  fingerprint: string;
  label: string;
  keyHint: string;
  status: string;
  failureCount: number;
  cooldownUntil: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewApiKeyRecord = {
  workspaceId: string;
  encryptedKey: string;
  fingerprint: string;
  label: string;
  keyHint: string;
  status: string;
};

export type NewGenerationRecord = {
  workspaceId: string;
  seed: string;
  styleSignature: string;
  mode: string;
  presetName: string;
  basePrompt: string;
  status: string;
};

const databaseGlobal = globalThis as typeof globalThis & { motionStudioDatabase?: DatabaseSync };
let databaseInstance: DatabaseSync | null = databaseGlobal.motionStudioDatabase ?? null;

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_URL?.trim() || "file:./prisma/dev.db";
  if (!configured.startsWith("file:")) {
    throw new Error("DATABASE_URL must use a local SQLite file URL such as file:./prisma/dev.db.");
  }
  const rawPath = decodeURIComponent(configured.slice("file:".length).split("?")[0] || "./prisma/dev.db");
  return isAbsolute(rawPath) ? rawPath : resolve(/* turbopackIgnore: true */ process.cwd(), rawPath.replace(/^\.\//, ""));
}

function createDatabase(): DatabaseSync {
  const path = resolveDatabasePath();
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5_000 });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS "Workspace" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "rotationCursor" INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS "ApiKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "workspaceId" TEXT NOT NULL,
      "encryptedKey" TEXT NOT NULL,
      "fingerprint" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "keyHint" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "failureCount" INTEGER NOT NULL DEFAULT 0,
      "cooldownUntil" TEXT,
      "lastUsedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ApiKey_workspaceId_fingerprint_key" UNIQUE ("workspaceId", "fingerprint")
    );
    CREATE INDEX IF NOT EXISTS "ApiKey_workspaceId_status_cooldownUntil_idx" ON "ApiKey" ("workspaceId", "status", "cooldownUntil");
    CREATE TABLE IF NOT EXISTS "Generation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "workspaceId" TEXT NOT NULL,
      "seed" TEXT NOT NULL UNIQUE,
      "styleSignature" TEXT NOT NULL,
      "mode" TEXT NOT NULL,
      "presetName" TEXT NOT NULL,
      "basePrompt" TEXT NOT NULL,
      "generatedPrompt" TEXT,
      "aiEnhanced" INTEGER NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'CREATED',
      "createdAt" TEXT NOT NULL,
      CONSTRAINT "Generation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS "Generation_workspaceId_styleSignature_idx" ON "Generation" ("workspaceId", "styleSignature");
    CREATE INDEX IF NOT EXISTS "Generation_workspaceId_createdAt_idx" ON "Generation" ("workspaceId", "createdAt");
    CREATE TABLE IF NOT EXISTS "Preset" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "workspaceId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "configuration" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      CONSTRAINT "Preset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Preset_workspaceId_name_key" UNIQUE ("workspaceId", "name")
    );
  `);

  const workspaceColumns = database.prepare(`PRAGMA table_info("Workspace")`).all() as Array<{ name?: string }>;
  if (!workspaceColumns.some((column) => column.name === "rotationCursor")) {
    database.exec(`ALTER TABLE "Workspace" ADD COLUMN "rotationCursor" INTEGER NOT NULL DEFAULT 0`);
  }
  return database;
}

function getDatabase(): DatabaseSync {
  if (databaseInstance) return databaseInstance;
  databaseInstance = createDatabase();
  if (process.env.NODE_ENV !== "production") databaseGlobal.motionStudioDatabase = databaseInstance;
  return databaseInstance;
}

function fromDatabaseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    encryptedKey: String(row.encryptedKey),
    fingerprint: String(row.fingerprint),
    label: String(row.label),
    keyHint: String(row.keyHint),
    status: String(row.status),
    failureCount: Number(row.failureCount),
    cooldownUntil: fromDatabaseDate(row.cooldownUntil),
    lastUsedAt: fromDatabaseDate(row.lastUsedAt),
    createdAt: fromDatabaseDate(row.createdAt) ?? new Date(0),
    updatedAt: fromDatabaseDate(row.updatedAt) ?? new Date(0),
  };
}

export function ensureWorkspace(id: string): void {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO "Workspace" ("id", "createdAt", "updatedAt") VALUES (?, ?, ?) ON CONFLICT("id") DO UPDATE SET "updatedAt" = excluded."updatedAt"`).run(id, timestamp, timestamp);
}

export function nextWorkspaceKeyIndex(workspaceId: string, keyCount: number): number {
  if (keyCount < 1) return 0;
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare(`SELECT "rotationCursor" FROM "Workspace" WHERE "id" = ?`).get(workspaceId) as { rotationCursor?: number } | undefined;
    const startIndex = ((Number(row?.rotationCursor ?? 0) % keyCount) + keyCount) % keyCount;
    database.prepare(`UPDATE "Workspace" SET "rotationCursor" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .run((startIndex + 1) % keyCount, new Date().toISOString(), workspaceId);
    database.exec("COMMIT");
    return startIndex;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function resetWorkspaceKeyIndex(workspaceId: string): void {
  const database = getDatabase();
  database.prepare(`UPDATE "Workspace" SET "rotationCursor" = 0, "updatedAt" = ? WHERE "id" = ?`).run(new Date().toISOString(), workspaceId);
}

export function getWorkspaceApiKeys(workspaceId: string): ApiKeyRecord[] {
  const database = getDatabase();
  const rows = database.prepare(`SELECT * FROM "ApiKey" WHERE "workspaceId" = ? ORDER BY "createdAt" ASC, "id" ASC`).all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map(mapApiKey);
}

export function replaceWorkspaceApiKeys(workspaceId: string, records: NewApiKeyRecord[]): void {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`DELETE FROM "ApiKey" WHERE "workspaceId" = ?`).run(workspaceId);
    const insert = database.prepare(`INSERT INTO "ApiKey" (
      "id", "workspaceId", "encryptedKey", "fingerprint", "label", "keyHint", "status", "failureCount", "cooldownUntil", "lastUsedAt", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`);
    for (const record of records) {
      insert.run(
        `key_${randomUUID().replace(/-/g, "")}`,
        record.workspaceId,
        record.encryptedKey,
        record.fingerprint,
        record.label,
        record.keyHint,
        record.status,
        timestamp,
        timestamp,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function deleteWorkspaceApiKeys(workspaceId: string): void {
  const database = getDatabase();
  database.prepare(`DELETE FROM "ApiKey" WHERE "workspaceId" = ?`).run(workspaceId);
}

export function markApiKeyUsed(id: string): void {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare(`UPDATE "ApiKey" SET "lastUsedAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(timestamp, timestamp, id);
}

export function markApiKeySuccessful(id: string): void {
  const database = getDatabase();
  database.prepare(`UPDATE "ApiKey" SET "failureCount" = 0, "cooldownUntil" = NULL, "updatedAt" = ? WHERE "id" = ?`).run(new Date().toISOString(), id);
}

export function coolDownApiKey(id: string, cooldownUntil: Date): void {
  const database = getDatabase();
  database.prepare(`UPDATE "ApiKey" SET "failureCount" = "failureCount" + 1, "cooldownUntil" = ?, "updatedAt" = ? WHERE "id" = ?`).run(cooldownUntil.toISOString(), new Date().toISOString(), id);
}

export function rejectApiKey(id: string): void {
  const database = getDatabase();
  database.prepare(`UPDATE "ApiKey" SET "status" = 'INVALID', "failureCount" = "failureCount" + 1, "updatedAt" = ? WHERE "id" = ?`).run(new Date().toISOString(), id);
}

export function hasStyleSignature(workspaceId: string, styleSignature: string): boolean {
  const database = getDatabase();
  const row = database.prepare(`SELECT 1 AS "present" FROM "Generation" WHERE "workspaceId" = ? AND "styleSignature" = ? LIMIT 1`).get(workspaceId, styleSignature) as { present?: number } | undefined;
  return row?.present === 1;
}

export function createGenerationRecord(record: NewGenerationRecord): string {
  const database = getDatabase();
  const id = `gen_${randomUUID().replace(/-/g, "")}`;
  database.prepare(`INSERT INTO "Generation" (
    "id", "workspaceId", "seed", "styleSignature", "mode", "presetName", "basePrompt", "generatedPrompt", "aiEnhanced", "status", "createdAt"
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`)
    .run(id, record.workspaceId, record.seed, record.styleSignature, record.mode, record.presetName, record.basePrompt, record.status, new Date().toISOString());
  return id;
}

export function saveGenerationResult(id: string, prompt: string, aiEnhanced: boolean, status: string): void {
  const database = getDatabase();
  database.prepare(`UPDATE "Generation" SET "generatedPrompt" = ?, "aiEnhanced" = ?, "status" = ? WHERE "id" = ?`).run(prompt, aiEnhanced ? 1 : 0, status, id);
}
