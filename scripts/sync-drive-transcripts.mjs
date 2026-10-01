import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

process.loadEnvFile();
const COURSE_API = process.env.VITE_DRIVE_WEB_APP_URL;
if (!COURSE_API) throw new Error('Missing VITE_DRIVE_WEB_APP_URL in .env');
const CDP_ENDPOINT = process.env.DRIVE_CDP_ENDPOINT || 'http://127.0.0.1:9334';
const OUTPUT_PATH = path.resolve('public/transcripts.json');
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const collectVideos = (folder, moduleName = '') => {
  const currentModule = folder.type === 'folder' && folder.name ? folder.name : moduleName;
  const own = (folder.files || [])
    .filter((file) => file.category === 'video')
    .map((file) => ({ ...file, moduleName: currentModule, parentFolderId: folder.id }));
  return (folder.children || []).reduce(
    (videos, child) => videos.concat(collectVideos(child, child.name || currentModule)),
    own,
  );
};

const course = await fetch(COURSE_API).then((response) => response.json());
const videos = collectVideos(course).slice(0, limit);
let transcripts = {};
try { transcripts = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8')); } catch { transcripts = {}; }

const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
const context = browser.contexts()[0];
const page = await context.newPage();
let added = 0;
let pending = 0;

for (const [index, video] of videos.entries()) {
  if (transcripts[video.id]?.text) continue;
  process.stdout.write(`[${index + 1}/${videos.length}] ${video.name} ... `);
  try {
    await page.goto(`https://drive.google.com/drive/u/0/folders/${video.parentFolderId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(5_000);
    const fileRow = page.getByText(video.name, { exact: true }).first();
    await fileRow.waitFor({ state: 'visible', timeout: 20_000 });
    await fileRow.dblclick();
    await page.waitForTimeout(3_000);
    await page.mouse.click(page.viewportSize()?.width / 2 || 640, page.viewportSize()?.height / 2 || 360);
    await page.waitForTimeout(10_000);
    await page.mouse.move(page.viewportSize()?.width / 2 || 640, page.viewportSize()?.height * 0.75 || 540);

    // Drive only hydrates the transcript after the caption track has been
    // requested. The standalone /file/d/... viewer often never does this.
    const captionsButton = page.locator('button[aria-label="Subtitles/Closed captions (c)"]:not(:disabled):visible').last();
    await captionsButton.waitFor({ state: 'visible', timeout: 30_000 });
    await captionsButton.click();
    await page.waitForTimeout(500);

    const candidates = page.locator('[aria-label="Transcript"]:visible');
    let opened = false;
    for (let candidateIndex = 0; candidateIndex < await candidates.count(); candidateIndex += 1) {
      const candidate = candidates.nth(candidateIndex);
      if (await candidate.getAttribute('aria-disabled') === 'true') continue;
      try { await candidate.click({ timeout: 2_000 }); opened = true; break; } catch { /* try next */ }
    }
    if (!opened) throw new Error('Drive has not enabled a transcript for this video yet');
    const sidebar = page.locator('[aria-label="Transcript sidebar"]');
    await sidebar.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(() => {
      const rawText = document.querySelector('[aria-label="Transcript sidebar"]')?.innerText || '';
      return rawText.length > 100 && /(^|\n)\d{1,2}:\d{2}(\n|$)/m.test(rawText);
    }, { timeout: 30_000 });
    const text = (await sidebar.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line
        && line !== 'Transcript'
        && line !== 'Close side sheet'
        && line !== 'Search transcript'
        && line !== 'Copy link to this transcript')
      .join('\n');
    if (text.length < 100 || !/(^|\n)\d{1,2}:\d{2}(\n|$)/m.test(text)) {
      throw new Error('Transcript panel contains no caption segments');
    }
    transcripts[video.id] = { lessonName: video.name, moduleName: video.moduleName, text, syncedAt: new Date().toISOString() };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(transcripts, null, 2)}\n`, 'utf8');
    added += 1;
    console.log('saved');
  } catch (error) {
    pending += 1;
    console.log(`pending (${error.message})`);
  }
}

await page.close();
await browser.close();
console.log(`Done. Added: ${added}; pending/unavailable: ${pending}; total cached: ${Object.keys(transcripts).length}.`);
