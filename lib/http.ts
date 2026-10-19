import { NextResponse } from "next/server";

export function jsonError(message: string, status: number, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: message, ...(details === undefined ? {} : { details }) },
    { status, headers: { "cache-control": "no-store" } },
  );
}
