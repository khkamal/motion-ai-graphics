# Motion AI Studio

A browser-first image-to-motion workspace built with Next.js App Router, React, TypeScript, Tailwind CSS, Gemini Vision, and FFmpeg. Workspace settings, key rotation, and recent motion signatures stay in the user's browser; there is no account database or cloud file store.

## Get started

Use Node.js 22.5 or newer. Install dependencies and start the studio:

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`; the landing page links to the workspace at `/dashboard`. `GEMINI_MODEL` is optional and defaults to `gemini-3.1-flash-lite`.

## Browser-local data

Gemini keys, the rotation cursor, recent variation signatures, and workspace controls are kept in that browser's local storage. Keys are not encrypted there, so use a private browser profile and do not save keys on shared devices. When generating a prompt, the browser sends the selected image, temporary key pool, and prompt settings to the stateless Next.js endpoint over HTTPS. The endpoint forwards the request to Gemini and does not write keys, images, prompts, or exports to a database. Images are not saved after the browser session; rendered files are streamed back and temporary server files are deleted.

Clearing the browser's site data removes its keys and saved settings. Other browsers and devices do not share them.

## Workspace and rendering

- Drag in PNG, JPEG, or WebP reference art (30 MB maximum). Choose 2D, 3D depth, or line-art direction.
- Randomize compositions, palettes, and particle treatments; add natural-language modifiers such as “scale particles up by 30%”.
- Preview at 0.25×, 1×, 2×, or 3×. Select original, checkerboard, green, blue, or custom matte colors.
- Record the animated stage in the browser, then encode a 30 FPS H.264 MP4 or QuickTime MOV with FFmpeg. Exports offer 5, 10, 15, or 30 seconds, 1080p or 4K UHD, and medium or slow encoding.

A Linux x64 FFmpeg binary is bundled. On other hosts, set `FFMPEG_PATH` to a trusted FFmpeg executable with `libx264` support. The bundled build enables GPL codecs; review FFmpeg and codec licensing before redistributing, or provide a build whose license fits your deployment.

## Vercel and deployment limits

The project uses the Next.js framework preset. Vercel Hobby allows a maximum 300-second function duration; `/api/render` is capped to that limit. Long 4K exports and large uploads may still exceed a serverless plan's execution or request limits. For reliable long-form stock renders, use a persistent Node.js host with enough temporary disk space and memory. The studio does not require a database or persistent cloud storage.

## Checks

```bash
npm run typecheck
npm run build
```
