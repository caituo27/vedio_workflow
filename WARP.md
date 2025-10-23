# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Build, Development, and Test Commands

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Clean build artifacts
npm run clean

# Run local development script with sample video
DEV_VIDEO="https://youtu.be/xxxx" GEMINI_API_KEY="your-key" npm run dev

# Run CLI after building
node dist/cli/index.js "<video-url>"
node dist/cli/index.js generate "<video-url>"  # Explicit generate command
node dist/cli/index.js delete "<video-url>"   # Delete transcript

# Lint (placeholder for future Python pipeline)
npm run lint

# Tests (not yet implemented)
npm test
```

## Project Architecture

This is a TypeScript-based video transcription pipeline that downloads audio from YouTube/Bilibili, transcribes it using Google Gemini, and publishes results to GitHub Pages.

### Pipeline Stages (src/)

The codebase follows a three-stage pipeline architecture:

1. **Ingest** (`src/ingest/`): Downloads audio using `yt-dlp`
   - `downloader.ts` handles YouTube/Bilibili extraction with bot-check fallback to Android user-agent
   - Outputs: audio file path, video title, duration, author

2. **Transform** (`src/transform/`): Converts audio to Chinese text
   - `gemini_transcriber.ts` sends audio to Gemini 2.0 Flash model
   - Returns semantic segments with timestamps and language detection
   - Handles JSON repair for malformed Gemini responses

3. **Deliver** (`src/deliver/`): Publishes results and manages state
   - `markdown_writer.ts` generates transcript Markdown files in `docs/data/word/`
   - `status_manager.ts` maintains job status in `docs/data/list/jobs.json`
   - `transcript_deleter.ts` handles transcript deletion (both file and index)
   - Failed jobs are automatically filtered from the index

### Entry Points

- `src/cli/index.ts`: Main CLI using Commander.js, orchestrates the full pipeline
- `src/cli/dev.ts`: Development script that reads `DEV_VIDEO` environment variable

### Utilities (`src/utils/`)

- `video.ts`: Parses YouTube/Bilibili URLs, generates job IDs
- `process.ts`: Wraps child_process for command execution
- `logger.ts`: Colored console output using chalk
- `fs.ts`: File system helpers for JSON read/write
- `slug.ts`: URL-safe string generation

### Data Flow

```
Video URL → downloadAudio() → audioPath
         → transcribeWithGemini() → segments[]
         → deliverMarkdown() → docs/data/word/{jobId}.md
         → markCompleted() → docs/data/list/jobs.json
```

Job records track: `jobId`, `title`, `videoUrl`, `transcriptPath`, `status`, `author`, `updatedAt`.

### GitHub Pages Integration

The `docs/` directory serves as the Pages root:
- `docs/data/list/jobs.json`: Job index consumed by frontend
- `docs/data/word/*.md`: Generated transcripts
- `docs/index.html`: Task list and query interface
- `docs/viewer.html`: Markdown transcript viewer

## Environment Variables

- `GEMINI_API_KEY` (required): Google Gemini API key
- `DEV_VIDEO`: Video URL for development script
- `YT_DLP_COOKIES_PATH`: Absolute path to yt-dlp cookies file
- `YT_DLP_COOKIES`: GitHub Actions secret that gets written to temp file

## GitHub Actions Workflow

`.github/workflows/transcript.yml` runs on manual dispatch:
1. Install Node.js 20, Python, ffmpeg, yt-dlp
2. Build TypeScript
3. Prepare cookies if secret provided
4. Execute pipeline
5. Commit changes to `docs/`
6. Deploy to GitHub Pages

## External Dependencies

- `yt-dlp`: Audio download (requires Python)
- `ffmpeg`/`ffprobe`: Audio processing
- `@google/generative-ai`: Gemini API client
- `jsonrepair`: Fix malformed JSON from Gemini
- `commander`: CLI argument parsing

## Important Notes

- Audio files are temporarily stored in `.cache/audio/` and cleaned up after processing
- The pipeline uses `gemini-2.0-flash` model for transcription
- Bot detection on YouTube triggers Android client fallback
- TypeScript config targets ES2022 with strict mode and ESM modules
- Failed jobs are excluded from `jobs.json` to keep the UI clean
