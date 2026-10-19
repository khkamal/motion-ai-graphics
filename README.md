# Motion AI Studio

A self-hostable image-to-motion workspace built with Next.js App Router, React, TypeScript, Tailwind CSS, Gemini Vision, SQLite, and FFmpeg.

## Get started

Use Node.js 22.5 or newer. Install dependencies and start the studio:

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`; the landing page links to the studio at `/dashboard`. The SQLite database and tables are created automatically on the first API request. By default the database file is `prisma/dev.db`; the datasource URL is also described in `prisma.config.ts` for Prisma tooling.

Set two separate secrets before production use:

```bash
openssl rand -base64 32
```

Use independently generated values for `API_KEY_ENCRYPTION_KEY` and `WORKSPACE_SECRET`. The former encrypts keys with AES-256-GCM; the latter signs the HTTP-only workspace cookie. The development-only fallbacks are intentionally unsuitable for a production deployment. Keep both values stable in your deployment secret manager and keep `.env` and database files out of source control. If the encryption secret is lost, stored Gemini keys must be entered again; keep the SQLite database on persistent, writable storage.

## Gemini prompt generation

Open **Gemini** in the workspace header and paste one or more Gemini API keys, separated by commas. The server stores only AES-256-GCM encrypted values and masked key hints. The key rotator advances round-robin, puts keys into a short cooldown after a 429 / `ResourceExhausted` response, and tries the next usable key. Rejected keys are marked invalid. If the key pool is empty, rate-limited, or Gemini is unreachable, the studio still creates a locally varied prompt and a new cryptographic motion seed.

`GEMINI_MODEL` defaults to `gemini-2.5-flash`. Set another supported Gemini `generateContent` model in `.env` if needed. Image payloads are resized in the browser for Vision requests; the original upload is used for the preview and render capture.

## Workspace and render engine

- Drag in PNG, JPEG, or WebP reference art (30 MB maximum). Choose 2D, 3D depth, or line-art direction.
- Randomize one of eight compositions, palettes, and particle treatments; add natural-language modifiers such as “scale particles up by 30%”.
- Preview at 0.25×, 1×, 2×, or 3×. Select original, checkerboard, green, blue, or custom matte colors.
- Record the animated stage in the browser, then encode a 30 FPS H.264 MP4 or QuickTime MOV in FFmpeg. Exports offer 5, 10, 15, or 30 seconds, 1080p or 4K UHD, and medium or slow encoding.

A Linux x64 FFmpeg binary is bundled for local use. On other hosts, set `FFMPEG_PATH` to a trusted FFmpeg executable with `libx264` support. The bundled build enables GPL codecs; review FFmpeg and codec licensing before redistributing, or provide a build whose license fits your deployment. Use a persistent Node.js host with enough temporary disk space and memory for large 4K uploads; serverless platforms with short request limits are not suitable for long stock renders.

## Data model

`prisma/schema.prisma` defines the workspace, encrypted API key, generation history, and saved-preset tables. The runtime bootstraps the matching SQLite schema through Node.js 22's built-in SQLite driver so the workspace remains runnable without a Prisma engine download. `npm run db:push` and `npm run db:studio` are available for deployments where the Prisma engine CDN is reachable.

## Checks

```bash
npm run typecheck
npm run build
```
