import fs from 'node:fs/promises';
import path from 'node:path';

process.loadEnvFile();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');

const MODEL = 'gemini-3.5-flash-lite';
const OUTPUT_PATH = path.resolve('public/in-video-exercises.json');
const BATCH_SIZE = 35;
const applyKnownOnly = process.argv.includes('--apply-known-only');
const cleanWord = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const data = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
const questions = [];

Object.entries(data).forEach(([videoId, entry]) => {
  (entry.groups || []).forEach((group, groupIndex) => {
    (group.questions || []).forEach((question, questionIndex) => {
      questions.push({
        key: `${videoId}:${groupIndex}:${questionIndex}`,
        lessonName: entry.lessonName,
        groupTitle: group.title,
        instruction: group.instruction,
        type: question.type,
        prompt: question.prompt,
        correctAnswer: question.correctAnswer,
        rubric: question.rubric,
        target: question,
      });
    });
  });
});

const enrichBatch = async (batch) => {
  const payload = batch.map(({ target: _target, ...question }) => question);
  const prompt = `Khôi phục phần "từ/cụm từ bắt buộc" đã bị mất khi số hóa bài tập từ video IELTS.

Mỗi mục có đề, đáp án và rubric. Hãy trả requiredWords là các từ/cụm từ dạng gốc mà ĐỀ GỐC ĐÃ CHO SẴN và bắt buộc người học dùng, thường hiện trong ngoặc như "(participate)".

Quy tắc:
- Với bài dịch sang tiếng Anh mà rubric tập trung vào một động từ/tính từ cụ thể, có thể suy ra đó là từ gợi ý được cho sẵn; trả dạng gốc của từ đó, ví dụ "participate", không trả cả "participate in" nếu đề chỉ cho động từ.
- Với bài word form, chỉ trả từ gốc được cho sẵn, không tiết lộ dạng đáp án cần biến đổi.
- Không đưa đáp án của câu điền từ, trắc nghiệm, reading/listening hoặc câu hỏi kiến thức vào requiredWords.
- Không tự thêm từ chỉ vì nó xuất hiện trong correctAnswer. Nếu không có bằng chứng hợp lý rằng đề đã cho sẵn từ bắt buộc, trả [].
- Giữ nguyên key. Chỉ trả JSON thuần dạng {"items":[{"key":"...","requiredWords":[]}]}.

Dữ liệu:
${JSON.stringify(payload)}`;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    const body = await response.json();
    if (response.ok && !body.error) {
      const parsed = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    }
    if (![429, 500, 502, 503].includes(response.status) || attempt === 5) {
      throw new Error(body.error?.message || `Gemini HTTP ${response.status}`);
    }
    await sleep(attempt * 3_000);
  }
  return [];
};

for (let offset = 0; !applyKnownOnly && offset < questions.length; offset += BATCH_SIZE) {
  const batch = questions.slice(offset, offset + BATCH_SIZE);
  const items = await enrichBatch(batch);
  const byKey = new Map(items.map((item) => [String(item?.key || ''), item]));
  batch.forEach((question) => {
    const item = byKey.get(question.key);
    question.target.requiredWords = Array.isArray(item?.requiredWords)
      ? [...new Set(item.requiredWords.map(cleanWord).filter(Boolean))].slice(0, 8)
      : [];
  });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`[${Math.min(offset + BATCH_SIZE, questions.length)}/${questions.length}] enriched`);
}

// The source slide in Video 03a visibly supplies these cue words in parentheses.
// Its transcript reads the sentences and answers, but does not read the parenthetical cues aloud.
const video03a = data['1CogUvyKr89olCivGcNCVzvhZc7CflfgL'];
if (video03a?.groups?.length >= 4) {
  const verbGroup = video03a.groups[3];
  const combinedIndex = verbGroup.questions.findIndex((question) => question.prompt.includes('phụ thuộc') && question.prompt.includes('tập trung'));
  if (combinedIndex >= 0) {
    verbGroup.questions.splice(combinedIndex, 1,
      {
        type: 'short-answer',
        prompt: 'Bạn không nên phụ thuộc quá mức vào họ.',
        correctAnswer: "You shouldn't depend too much on them.",
        rubric: 'Sử dụng đúng động từ depend đi với giới từ on.',
        placeholder: 'Nhập câu tiếng Anh...',
        requiredWords: ['depend'],
      },
      {
        type: 'short-answer',
        prompt: 'Bạn nên tập trung vào việc học tập của mình nếu bạn muốn đậu kỳ thi sắp tới.',
        correctAnswer: 'You should focus on your study if you want to pass the upcoming exam.',
        rubric: 'Sử dụng đúng động từ focus đi với giới từ on.',
        placeholder: 'Nhập câu tiếng Anh...',
        requiredWords: ['focus'],
      });
  }

  const cueMap = [
    ['chán nản', 'tired'], ['thích nấu ăn', 'fond'], ['đầy những thử thách', 'full'], ['tự hào', 'proud'],
    ['nhận thức được', 'aware'], ['có khả năng', 'capable'], ['thiếu thời gian', 'short'], ['cam kết', 'committed'],
    ['nghiện game', 'addicted'], ['chống đối', 'opposed'], ['chưa quen', 'accustomed'], ['nổi tiếng', 'famous'],
    ['phù hợp', 'suitable'], ['chịu trách nhiệm', 'responsible'], ['chứa nhiều mỡ', 'rich'], ['dính líu', 'involved'],
    ['thích xem phim', 'interested'], ['thuộc về Việt Nam', 'belong'], ['thích môn tiếng Anh', 'prefer'],
    ['đóng góp', 'contribute'], ['tham gia vào các hoạt động', 'participate'], ['đầu tư nhiều tiền', 'invest'],
    ['thành công', 'succeed'], ['phụ thuộc', 'depend'], ['tập trung vào việc học tập', 'focus'],
    ['lười biếng ngăn', 'prevent'], ['bị bệnh tim', 'suffer'], ['Tầng ozone', 'protect'],
  ];
  video03a.groups.flatMap((group) => group.questions).forEach((question) => {
    const cue = cueMap.find(([fragment]) => question.prompt.includes(fragment));
    if (cue) question.requiredWords = [cue[1]];
  });
}

// Remove a false positive from an open-ended speaking prediction question.
Object.values(data).forEach((entry) => (entry.groups || []).forEach((group) => (group.questions || []).forEach((question) => {
  if (question.prompt === 'How do you think censorship laws will change in 20 years?') question.requiredWords = [];
})));

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
const allQuestions = Object.values(data).flatMap((entry) => (entry.groups || []).flatMap((group) => group.questions || []));
const requiredCount = allQuestions.filter((question) => question.requiredWords?.length).length;
console.log(`Done. ${requiredCount}/${allQuestions.length} questions have required words.`);
