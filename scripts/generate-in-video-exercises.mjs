import fs from 'node:fs/promises';
import path from 'node:path';

process.loadEnvFile();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');

const MODEL = 'gemini-3.5-flash-lite';
const TRANSCRIPTS_PATH = path.resolve('public/transcripts.json');
const OUTPUT_PATH = path.resolve('public/in-video-exercises.json');
const onlyArg = process.argv.find((value) => value.startsWith('--only='));
const onlyId = onlyArg?.slice('--only='.length) || '';
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
const force = process.argv.includes('--force');

const cuePattern = /(?:pause|dừng(?:\s+video)?|làm bài|bài tập|thực hành|hãy làm|tự làm|trả lời|đáp án|cho video chạy|dịch .* sang|viết .* câu)/i;
const allowedTypes = new Set(['multiple-choice', 'fill-blank', 'sentence-completion', 'short-answer', 'long-answer', 'application']);

const cleanString = (value, limit = 2_000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

const normalizeQuestion = (question) => {
  const prompt = cleanString(question?.prompt, 1_500);
  const correctAnswer = cleanString(question?.correctAnswer, 2_500);
  if (!prompt || !correctAnswer) return null;
  const type = allowedTypes.has(question?.type) ? question.type : 'short-answer';
  const normalized = {
    type,
    prompt,
    correctAnswer,
    rubric: cleanString(question?.rubric, 2_500) || `Câu trả lời cần thể hiện đúng nội dung: ${correctAnswer}`,
    placeholder: cleanString(question?.placeholder, 300) || 'Nhập câu trả lời của bạn…',
    requiredWords: Array.isArray(question?.requiredWords)
      ? question.requiredWords.map((word) => cleanString(word, 100)).filter(Boolean).slice(0, 8)
      : [],
  };
  if (type === 'multiple-choice') {
    normalized.options = Array.isArray(question?.options)
      ? question.options.map((option) => cleanString(option, 500)).filter(Boolean).slice(0, 6)
      : [];
    if (normalized.options.length < 2 || !normalized.options.includes(correctAnswer)) normalized.type = 'short-answer';
  }
  return normalized;
};

const normalizeOutput = (raw) => {
  const sourceGroups = Array.isArray(raw) ? raw : Array.isArray(raw?.groups) ? raw.groups : [];
  return sourceGroups.slice(0, 12).map((group, groupIndex) => {
    const questions = (Array.isArray(group?.questions) ? group.questions : [])
      .map(normalizeQuestion)
      .filter(Boolean)
      .slice(0, 50);
    if (!questions.length) return null;
    return {
      id: `exercise-${groupIndex + 1}`,
      title: cleanString(group?.title, 180) || `Bài tập trong video ${groupIndex + 1}`,
      instruction: cleanString(group?.instruction, 700),
      startTime: cleanString(group?.startTime, 12),
      answerTime: cleanString(group?.answerTime, 12),
      questions,
    };
  }).filter(Boolean);
};

const dedupeGroups = (groups = []) => {
  return groups.map((group) => {
    const seen = new Set();
    return {
      ...group,
      questions: group.questions.filter((question) => {
      const key = question.prompt.toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
      }),
    };
  }).filter((group) => group.questions.length);
};

const buildPrompt = (lessonName, transcript) => `Bạn đang trích xuất bài tập CỐ ĐỊNH từ transcript một video học IELTS.

Mục tiêu: tìm TẤT CẢ cụm bài tập mà giảng viên yêu cầu người học tự làm (thường yêu cầu pause/dừng video, dịch câu, điền đáp án, trả lời hoặc thực hành), rồi sau đó giảng viên đưa đáp án hoặc chữa bài ngay trong cùng video.

Quy tắc bắt buộc:
- Chỉ lấy bài tập thực sự được giao cho người học và có phần đáp án/chữa đủ rõ trong transcript.
- Bỏ qua lời nhắc chung như "hãy làm bài tập nhiều", bài tập về nhà/sách bài tập không có đề và đáp án trong video, ví dụ minh họa thông thường, câu hỏi tu từ khi giảng.
- Nếu đề xuất hiện trên màn hình nhưng transcript chỉ đọc đề khi bắt đầu chữa, được phép tái dựng đề từ chính câu mà giảng viên đang chữa; không tự sáng tác nội dung ngoài transcript.
- Tìm mọi vị trí trong video, không dừng sau bài tập đầu tiên.
- Không được lấy mẫu hoặc rút gọn còn 3-5 câu. Nếu phần chữa đánh số tới câu 10, phải tạo đủ cả 10 câu; nếu đánh số tới câu 20, phải tạo đủ cả 20 câu.
- Một bài có nhiều phần thì phải giữ đủ từng phần riêng biệt theo đúng thứ tự video. Chỉ được bỏ một câu khi transcript hoàn toàn không cho phép xác định cả đề lẫn đáp án.
- Mỗi câu hỏi phải tự đủ nghĩa, không nhắc "câu này", "hình trên" hoặc yêu cầu nhớ timestamp.
- correctAnswer phải là đáp án cụ thể rút từ phần chữa. rubric giải thích tiêu chí chấm, không chỉ lặp lại đề.
- Nếu đề trên màn hình hoặc lời giảng cho sẵn từ/cụm từ bắt buộc phải dùng (thường nằm trong ngoặc như "(participate)"), chép chính xác dạng gốc vào requiredWords. Không được làm mất gợi ý này. Nếu đề không cho sẵn từ bắt buộc, dùng requiredWords: [].
- Ưu tiên short-answer/fill-blank/sentence-completion. Chỉ dùng multiple-choice khi transcript nêu rõ các lựa chọn.
- Giữ tối đa 12 cụm bài tập và 50 câu mỗi cụm. Nếu không có cụm phù hợp, trả {"groups":[]}.
- Không tạo nhóm chỉ từ một câu ví dụ đơn lẻ.

Trả JSON thuần theo cấu trúc:
{"groups":[{"title":"...","instruction":"...","startTime":"MM:SS","answerTime":"MM:SS","questions":[{"type":"short-answer","prompt":"...","correctAnswer":"...","rubric":"...","placeholder":"...","requiredWords":["participate"],"options":[]}]}]}

Tên video: ${lessonName}
Transcript:
${transcript}`;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const generate = async (lessonName, transcript) => {
  const prompt = buildPrompt(lessonName, transcript);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 32768 },
      }),
    });
    const data = await response.json();
    if (response.ok && !data.error) {
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      try {
        return normalizeOutput(JSON.parse(text));
      } catch (error) {
        if (attempt === 5) throw error;
        await sleep(attempt * 2_000);
        continue;
      }
    }
    if (![429, 500, 502, 503].includes(response.status) || attempt === 5) {
      throw new Error(data.error?.message || `Gemini HTTP ${response.status}`);
    }
    await sleep(attempt * 4_000);
  }
  return [];
};

const transcripts = JSON.parse(await fs.readFile(TRANSCRIPTS_PATH, 'utf8'));
let output = {};
try { output = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8')); } catch { output = {}; }

const selected = Object.entries(transcripts)
  .filter(([id]) => !onlyId || id === onlyId)
  .filter(([id]) => force || !output[id])
  .slice(0, limit);

let generated = 0;
let skipped = 0;
for (const [index, [id, transcript]] of selected.entries()) {
  process.stdout.write(`[${index + 1}/${selected.length}] ${transcript.lessonName} ... `);
  try {
    const groups = cuePattern.test(transcript.text)
      ? await generate(transcript.lessonName, transcript.text)
      : [];
    output[id] = { lessonName: transcript.lessonName, groups };
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    generated += 1;
    console.log(`${groups.length} group(s)`);
  } catch (error) {
    skipped += 1;
    console.log(`failed (${error.message})`);
  }
}

Object.values(output).forEach((entry) => { entry.groups = dedupeGroups(entry.groups); });
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`Done. Generated: ${generated}; failed: ${skipped}; stored videos: ${Object.keys(output).length}.`);
