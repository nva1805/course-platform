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
Use `vercel dev` for local development because the course cache, video stream and AI grading use Vercel Functions.

## Native video playback

The app streams private course videos through the Drive API so mobile browsers display one native control layer instead of the embedded Google Drive player. The server-side Drive credentials are required for video playback.

The media function runs in Vercel's Singapore region and requests the original MP4 in bounded byte ranges. Video files remain in Drive and are neither transcoded nor copied to Vercel storage.
The course tree is cached at Vercel for five minutes and can be served stale while it refreshes in the background. After the tree loads, the frontend warms the Google authorization token so the first video request does less work.

1. Create a Google Cloud service account and enable the Google Drive API in that project.
2. Share the course's root Drive folder with the service-account email as **Viewer**.
3. Add `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` to the Vercel project's environment variables.
4. Keep `VITE_DRIVE_WEB_APP_URL` configured for Production, Preview, and Development so the frontend can load the course tree.
5. Redeploy. Visitors can watch through the Vercel website without receiving direct access to the restricted Drive folder.

Never expose the service-account private key through a `VITE_` variable or commit it to Git.
The service account should not receive project IAM roles or access to unrelated Drive folders; the shared course folder is its complete media boundary.

## Commands

Use `npm run exercises:generate` to rebuild `public/in-video-exercises.json` from the synchronized transcripts.
Use `npm run exercises:enrich-required-words` after generation to restore explicit cue words supplied by the original exercises.
Use `npm run summaries:generate` to rebuild the fixed lesson summaries shown below each video.

- `npm run dev` — start the local development server.
- `npm run build` — create a production build.
- `npm run lint` — check the source code.
- `npm run transcripts:sync` — synchronize available Google Drive transcripts into `public/transcripts.json`.
