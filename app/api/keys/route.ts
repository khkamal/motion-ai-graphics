import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteWorkspaceApiKeys, getWorkspaceApiKeys, replaceWorkspaceApiKeys, type NewApiKeyRecord } from "@/lib/database";
import { encryptApiKey, fingerprintApiKey, parseApiKeyInput } from "@/lib/keyVault";
import { jsonError } from "@/lib/http";
import { resetKeyRotation } from "@/lib/keyRotator";
import { attachWorkspaceCookie, resolveWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveSchema = z.object({
  keys: z.union([z.array(z.string()), z.string()]).optional(),
  keyInput: z.string().optional(),
});

async function listKeys(workspaceId: string): Promise<{ keys: Array<Record<string, unknown>>; total: number }> {
  const records = getWorkspaceApiKeys(workspaceId);
  const now = new Date();
  return {
    total: records.length,
    keys: records.map((record) => ({
      id: record.id,
      label: record.label,
      masked: `•••• ${record.keyHint}`,
      status: record.cooldownUntil && record.cooldownUntil > now ? "COOLDOWN" : record.status,
      failureCount: record.failureCount,
      cooldownUntil: record.cooldownUntil?.toISOString() ?? null,
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let workspaceId: string | undefined;
  try {
    workspaceId = await resolveWorkspace(request);
    const data = await listKeys(workspaceId);
    return attachWorkspaceCookie(
      NextResponse.json(data, { headers: { "cache-control": "no-store" } }),
      workspaceId,
    );
  } catch (error) {
    console.error("API key pool could not be loaded:", error);
    const response = jsonError("The API key pool could not be loaded. Check the database configuration.", 500);
    return workspaceId ? attachWorkspaceCookie(response, workspaceId) : response;
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  let workspaceId: string | undefined;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) return jsonError("The API key request is too large.", 413);
  try {
    const body: unknown = await request.json();
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success || (parsed.data.keys === undefined && parsed.data.keyInput === undefined)) {
      return jsonError("Send a comma-separated keyInput string or a keys array.", 400);
    }

    const input = parsed.data.keys ?? parsed.data.keyInput ?? "";
    const keys = parseApiKeyInput(input);
    const activeWorkspaceId = await resolveWorkspace(request);
    workspaceId = activeWorkspaceId;

    const createData: NewApiKeyRecord[] = keys.map((value, index) => ({
      workspaceId: activeWorkspaceId,
      encryptedKey: encryptApiKey(value),
      fingerprint: fingerprintApiKey(value),
      label: `Gemini key ${String(index + 1).padStart(2, "0")}`,
      keyHint: value.slice(-4),
      status: "ACTIVE",
    }));
    replaceWorkspaceApiKeys(activeWorkspaceId, createData);
    await resetKeyRotation(activeWorkspaceId);

    const data = await listKeys(activeWorkspaceId);
    return attachWorkspaceCookie(
      NextResponse.json({ ...data, message: keys.length === 0 ? "The Gemini key pool was cleared." : "Gemini keys were encrypted and saved." }, {
        headers: { "cache-control": "no-store" },
      }),
      activeWorkspaceId,
    );
  } catch (error) {
    console.error("API key pool could not be saved:", error);
    const message = error instanceof Error ? error.message : "The API key pool could not be saved.";
    const isInputError = message.startsWith("Each Gemini API key") || message.startsWith("A workspace can store up to");
    const status = isInputError ? 400 : 500;
    const response = jsonError(message, status);
    return workspaceId ? attachWorkspaceCookie(response, workspaceId) : response;
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let workspaceId: string | undefined;
  try {
    workspaceId = await resolveWorkspace(request);
    deleteWorkspaceApiKeys(workspaceId);
    await resetKeyRotation(workspaceId);
    return attachWorkspaceCookie(
      NextResponse.json({ keys: [], total: 0, message: "The Gemini key pool was cleared." }, {
        headers: { "cache-control": "no-store" },
      }),
      workspaceId,
    );
  } catch (error) {
    console.error("API key pool could not be cleared:", error);
    const response = jsonError("The API key pool could not be cleared.", 500);
    return workspaceId ? attachWorkspaceCookie(response, workspaceId) : response;
  }
}
