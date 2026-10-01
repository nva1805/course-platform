const cleanTitle = (name = '') => name
  .replace(/\.[^/.]+$/, '')
  .replace(/\b(?:IELTS Online Courses?|Video)\b/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

const question = (lessonId, index, text, rubric, placeholder, extras = {}) => ({
  id: `${lessonId}-q${index}`,
  text,
  rubric,
  placeholder,
  type: 'long-answer',
  ...extras,
});

const transcriptSegments = (transcript = '') => {
  const segments = [];
  let current;
  transcript.split('\n').forEach((line) => {
    const value = line.trim();
    if (/^\d{1,2}:\d{2}$/.test(value)) {
      current = { time: value, text: '' };
      segments.push(current);
    } else if (current && value) current.text += `${current.text ? ' ' : ''}${value}`;
  });
  return segments.filter((segment) => segment.text.length > 25);
};

const excerpt = (segment, limit = 155) => {
  const value = segment?.text || '';
  return value.length > limit ? `${value.slice(0, limit - 1).trim()}…` : value;
};

const pickKeyword = (text = '') => {
  const ignored = new Set(['những', 'trong', 'được', 'mình', 'chúng', 'chính', 'video', 'không', 'thì', 'các', 'một', 'this', 'that', 'with', 'from', 'have', 'your']);
  const words = text.match(/[A-Za-zÀ-ỹĐđ]{5,}/g) || [];
  return words.find((word) => !ignored.has(word.toLowerCase())) || words[0] || 'nội dung';
};

const buildTranscriptExercise = (moduleName, lesson, transcript) => {
  const segments = transcriptSegments(transcript);
  if (segments.length < 6) return null;
  const title = cleanTitle(lesson.name);
  const at = (ratio) => segments[Math.min(segments.length - 1, Math.floor(segments.length * ratio))];
  const anchor = at(0.45);
  const later = at(0.72);
  const keyword = pickKeyword(anchor.text);
  const blanked = excerpt(anchor, 210).replace(keyword, '_____');
  const completionWords = later.text.split(/\s+/);
  const splitAt = Math.min(12, Math.max(6, Math.floor(completionWords.length * 0.42)));
  const sentenceStart = completionWords.slice(0, splitAt).join(' ');
  const expectedCompletion = completionWords.slice(splitAt).join(' ');
  const module = moduleName.toLowerCase();
  let applicationPrompt = 'Tự tạo hai ví dụ tiếng Anh áp dụng nội dung trọng tâm của bài và giải thích ngắn vì sao mỗi ví dụ đúng.';
  let applicationRubric = 'Hai ví dụ liên quan trực tiếp đến bài học, đúng ngữ pháp và có giải thích phù hợp với transcript.';
  let correctStrategy = 'Tự giải thích kiến thức bằng lời của mình, áp dụng vào ví dụ mới rồi kiểm tra và sửa lỗi.';
  let wrongStrategies = ['Chỉ ghi nhớ nguyên văn nội dung mà không cần thực hành.', 'Bỏ qua lỗi sai miễn là đã xem hết video.'];

  if (module.includes('speaking') || module.includes('nói')) {
    applicationPrompt = 'Trả lời chủ đề của bài bằng 4–6 câu tiếng Anh, có ít nhất một lý do và một ví dụ cụ thể.';
    applicationRubric = 'Đúng chủ đề, có phát triển ý, lý do và ví dụ; ngôn ngữ tự nhiên và tương đối chính xác.';
    correctStrategy = 'Tự trả lời, phát triển ý bằng lý do và ví dụ, sau đó nghe lại để sửa cách diễn đạt.';
    wrongStrategies = ['Học thuộc một câu trả lời duy nhất cho mọi chủ đề.', 'Chỉ trả lời một vài từ để hạn chế mắc lỗi.'];
  } else if (module.includes('writing') || module.includes('viết')) {
    applicationPrompt = 'Viết một câu hoặc đoạn ngắn áp dụng kỹ thuật trong bài, rồi chỉ rõ bạn đã áp dụng kỹ thuật đó ở đâu.';
    applicationRubric = 'Sản phẩm viết đúng mục đích; phần giải thích chỉ ra chính xác kỹ thuật lấy từ transcript.';
    correctStrategy = 'Lập ý, áp dụng kỹ thuật của bài, viết thử rồi tự kiểm tra và chỉnh sửa.';
    wrongStrategies = ['Viết ngay không cần xác định yêu cầu hay lập ý.', 'Ưu tiên từ thật khó dù không chắc cách dùng.'];
  } else if (module.includes('reading') || module.includes('đọc') || module.includes('listening') || module.includes('nghe')) {
    applicationPrompt = 'Mô tả cách áp dụng chiến lược của bài vào một bài tập thực tế, theo từng bước.';
    applicationRubric = 'Quy trình có thứ tự, bám sát chiến lược trong transcript và có bước kiểm tra đáp án.';
    correctStrategy = 'Áp dụng chiến lược theo từng bước, chú ý từ khóa/ngữ cảnh và kiểm tra lại đáp án.';
    wrongStrategies = ['Dừng quá lâu ở một câu khó và bỏ lỡ toàn bộ phần sau.', 'Chọn đáp án chỉ vì thấy một từ giống hệt đề bài.'];
  }
  const options = [wrongStrategies[0], correctStrategy, wrongStrategies[1]];

  return {
    title: `Ôn tập: ${title}`,
    questions: [
      question(lesson.id, 1, `Sau khi học xong “${title}”, hãy trình bày ba kiến thức, quy tắc hoặc chiến lược quan trọng nhất mà bạn rút ra được.`, 'Có ít nhất ba ý chính xác, bao quát bài học và được diễn đạt bằng lời của người học.', 'Ý 1…\nÝ 2…\nÝ 3…', { type: 'short-answer' }),
      question(lesson.id, 2, `Cách nào dưới đây thể hiện bạn đã hiểu và biết vận dụng bài “${title}”?`, `Đáp án đúng là: “${correctStrategy}”`, 'Chọn một đáp án', { type: 'multiple-choice', options, correctAnswer: correctStrategy }),
      question(lesson.id, 3, `Điền thuật ngữ còn thiếu để hoàn chỉnh một ghi chú kiến thức rút ra từ bài: “${blanked}”`, `Từ cần điền là “${keyword}”. Chấp nhận khác biệt viết hoa/thường.`, 'Nhập thuật ngữ còn thiếu…', { type: 'fill-blank', correctAnswer: keyword }),
      question(lesson.id, 4, `Viết lại và hoàn thiện ghi chú sau sao cho rõ nghĩa, dễ dùng khi ôn tập: “${sentenceStart} …”`, `Cần giữ đúng ý kiến thức trong bài. Nội dung tham khảo từ transcript: “${expectedCompletion}”. Không bắt buộc chép nguyên văn.`, 'Hoàn thiện ghi chú bằng lời của bạn…', { type: 'sentence-completion', correctAnswer: expectedCompletion }),
      question(lesson.id, 5, `Nêu một lỗi dễ mắc khi áp dụng nội dung “${title}”, sau đó sửa lỗi và giải thích vì sao cách sửa là đúng.`, 'Có lỗi cụ thể, cách sửa phù hợp với bài học và lời giải thích rõ ràng.', 'Lỗi thường gặp…\nCách sửa…\nGiải thích…'),
      question(lesson.id, 6, applicationPrompt, applicationRubric, 'Câu trả lời của bạn…', { type: 'application' }),
    ],
  };
};

const buildFallbackExercise = (moduleName, lesson) => {
  const title = cleanTitle(lesson.name);
  const module = moduleName.toLowerCase();
  const skill = module.includes('speaking') || module.includes('nói') ? 'kỹ năng nói' : module.includes('writing') || module.includes('viết') ? 'kỹ năng viết' : module.includes('reading') || module.includes('đọc') ? 'kỹ năng đọc' : module.includes('listening') || module.includes('nghe') ? 'kỹ năng nghe' : 'ngữ pháp';
  return {
    title: `Ôn tập: ${title}`,
    questions: [
      question(lesson.id, 1, `Nêu mục tiêu chính của bài “${title}”.`, 'Trả lời đúng trọng tâm của bài học.', 'Mục tiêu chính là…', { type: 'short-answer' }),
      question(lesson.id, 2, 'Liệt kê ba từ khóa hoặc khái niệm quan trọng trong bài.', 'Có ba mục liên quan trực tiếp đến nội dung.', '1. …\n2. …\n3. …'),
      question(lesson.id, 3, 'Hoàn thành câu: “Sau bài học này, điều quan trọng nhất tôi cần nhớ là…”', 'Hoàn thành câu cụ thể và đúng nội dung.', '…', { type: 'sentence-completion' }),
      question(lesson.id, 4, `Nêu một lỗi thường gặp khi áp dụng nội dung ${skill} trong bài.`, 'Lỗi cụ thể và liên quan đến chủ đề.', 'Lỗi thường gặp là…', { type: 'short-answer' }),
      question(lesson.id, 5, 'Sửa lỗi trên và giải thích quy tắc hoặc chiến lược đúng.', 'Có cách sửa và lời giải thích rõ ràng.', 'Cách sửa…\nGiải thích…'),
      question(lesson.id, 6, 'Tạo một ví dụ thực tế áp dụng nội dung vừa học.', 'Ví dụ đúng chủ đề, rõ ràng và có giải thích.', 'Ví dụ của bạn…', { type: 'application' }),
    ],
  };
};

export const buildExercise = (moduleName = '', lesson = {}, transcript = '') => {
  if (lesson.category !== 'video') return null;
  return buildTranscriptExercise(moduleName, lesson, transcript) || buildFallbackExercise(moduleName, lesson);
};
