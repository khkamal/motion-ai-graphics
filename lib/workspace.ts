import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { ensureWorkspace } from "@/lib/database";

const COOKIE_NAME = "motion_ai_workspace";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function getWorkspaceSecret(): string {
  const configured = process.env.WORKSPACE_SECRET;
  if (configured && (process.env.NODE_ENV !== "production" || configured.length >= 32)) return configured;
  if (configured && process.env.NODE_ENV === "production") {
    throw new Error("WORKSPACE_SECRET must contain at least 32 characters in production.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("WORKSPACE_SECRET must be configured before serving production requests.");
  }
  return "motion-ai-studio-development-workspace-secret";
}

function signatureFor(id: string): string {
  return createHmac("sha256", getWorkspaceSecret()).update(id).digest("base64url");
}

function readWorkspaceId(request: NextRequest): string | null {
  const value = request.cookies.get(COOKIE_NAME)?.value;
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  if (!/^[a-f0-9-]{36}$/i.test(id) || !suppliedSignature) return null;

  try {
    const expected = Buffer.from(signatureFor(id));
    const actual = Buffer.from(suppliedSignature);
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
  } catch {
    return null;
  }
}

export async function resolveWorkspace(request: NextRequest): Promise<string> {
  getWorkspaceSecret();
  const id = readWorkspaceId(request) ?? randomUUID();
  ensureWorkspace(id);
  return id;
}

export function attachWorkspaceCookie<T extends NextResponse>(response: T, id: string): T {
  response.cookies.set(COOKIE_NAME, `${id}.${signatureFor(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
