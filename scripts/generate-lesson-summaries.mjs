import fs from 'node:fs/promises';
import path from 'node:path';

process.loadEnvFile();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');

const MODEL = 'gemini-3.5-flash-lite';
const TRANSCRIPTS_PATH = path.resolve('public/transcripts.json');
const OUTPUT_PATH = path.resolve('public/lesson-summaries.json');
const force = process.argv.includes('--force');
const onlyArg = process.argv.find((value) => value.startsWith('--only='));
const onlyId = onlyArg?.slice('--only='.length) || '';
const clean = (value, limit = 2_000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalize = (raw) => ({
  overview: clean(raw?.overview, 1_200),
  keyPoints: Array.isArray(raw?.keyPoints) ? raw.keyPoints.map((item) => clean(item, 500)).filter(Boolean).slice(0, 8) : [],
  practiceFocus: clean(raw?.practiceFocus, 700),
});

const summarize = async (lessonName, transcript) => {
  const prompt = `Tóm tắt một bài học từ transcript bên dưới để hiển thị trên nền tảng học tập.

Yêu cầu:
- Viết bằng tiếng Việt tự nhiên, chính xác và ngắn gọn.
- overview gồm 2-3 câu nêu mục tiêu và nội dung chính của bài.
- keyPoints gồm 4-7 ý quan trọng người học cần ghi nhớ; mỗi ý tự đủ nghĩa, không nhắc timestamp và không nói "giảng viên nói".
- practiceFocus gồm 1-2 câu hướng dẫn người học nên luyện gì sau bài.
- Không thêm kiến thức không có trong transcript, không chép dài nguyên văn và không nhắc lỗi nhận dạng giọng nói.
- Trả JSON thuần: {"overview":"...","keyPoints":["..."],"practiceFocus":"..."}

Tên bài: ${lessonName}
Transcript:
${transcript}`;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
    const body = await response.json();
    if (response.ok && !body.error) {
      try {
        const parsed = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        const result = normalize(parsed);
        if (!result.overview || result.keyPoints.length < 3) throw new Error('Summary is incomplete');
        return result;
      } catch (error) {
        if (attempt === 5) throw error;
        await sleep(attempt * 2_000);
        continue;
      }
    }
    if (![429, 500, 502, 503].includes(response.status) || attempt === 5) {
      throw new Error(body.error?.message || `Gemini HTTP ${response.status}`);
    }
    await sleep(attempt * 3_000);
  }
  throw new Error('Could not generate summary');
};

const transcripts = JSON.parse(await fs.readFile(TRANSCRIPTS_PATH, 'utf8'));
let output = {};
try { output = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8')); } catch { output = {}; }

const selected = Object.entries(transcripts)
  .filter(([id]) => !onlyId || id === onlyId)
  .filter(([id]) => force || !output[id]);

let completed = 0;
let failed = 0;
for (let offset = 0; offset < selected.length; offset += 4) {
  const batch = selected.slice(offset, offset + 4);
  const results = await Promise.all(batch.map(async ([id, transcript]) => {
    try {
      const summary = await summarize(transcript.lessonName, transcript.text);
      return { id, entry: { lessonName: transcript.lessonName, ...summary } };
    } catch (error) {
      console.error(`Failed: ${transcript.lessonName} (${error.message})`);
      return null;
    }
  }));
  results.forEach((result) => {
    if (!result) { failed += 1; return; }
    output[result.id] = result.entry;
    completed += 1;
  });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`[${Math.min(offset + batch.length, selected.length)}/${selected.length}] summaries processed`);
}

console.log(`Done. Generated: ${completed}; failed: ${failed}; stored: ${Object.keys(output).length}.`);
