# Course Platform

A personal learning platform for organizing course materials, watching video lessons, reading synced transcripts, completing fixed exercises, and receiving AI-assisted grading.

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and configure the Drive Web App URL and optional default Gemini API key.

## Commands

- `npm run dev` — start the local development server.
- `npm run build` — create a production build.
- `npm run lint` — check the source code.
- `npm run transcripts:sync` — synchronize available Google Drive transcripts into `public/transcripts.json`.
