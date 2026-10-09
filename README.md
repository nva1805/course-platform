# Course Platform

A personal learning platform for organizing course materials, watching video lessons, reading synced transcripts, completing fixed exercises, and receiving AI-assisted grading.

Each video keeps two separate exercise sets when transcript evidence is available:

- review questions generated from the lesson content;
- exercises explicitly assigned and answered by the instructor inside the video.

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and configure the Drive Web App URL and server-side Gemini API key.
Use `vercel dev` when testing AI grading locally because `/api/grade` is a Vercel Function.

## Commands

Use `npm run exercises:generate` to rebuild `public/in-video-exercises.json` from the synchronized transcripts.
Use `npm run exercises:enrich-required-words` after generation to restore explicit cue words supplied by the original exercises.
Use `npm run summaries:generate` to rebuild the fixed lesson summaries shown below each video.

- `npm run dev` — start the local development server.
- `npm run build` — create a production build.
- `npm run lint` — check the source code.
- `npm run transcripts:sync` — synchronize available Google Drive transcripts into `public/transcripts.json`.
