import { useEffect, useMemo, useState } from 'react';
import { buildExercise } from './exercises';

const WEB_APP_URL = import.meta.env.VITE_DRIVE_WEB_APP_URL || '';
const DEFAULT_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY?.trim() || '';
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const stripExtension = (name = '') => name.replace(/\.[^/.]+$/, '');

const getAllFiles = (folder) => {
  let files = (folder.files || []).map((file) => ({ ...file, parentFolderId: folder.id }));
  (folder.children || []).forEach((child) => { files = files.concat(getAllFiles(child)); });
  return files;
};

const FileIcon = ({ type }) => (
  <span className={`file-icon file-icon--${type === 'pdf' ? 'pdf' : 'media'}`} aria-hidden="true">
    {type === 'pdf' ? 'PDF' : '▶'}
  </span>
);

const TranscriptSection = ({ lesson, bundled = '' }) => {
  return (
    <section className="learning-card transcript-card">
      <div className="card-heading">
        <div><span className="eyebrow">Nội dung bài giảng</span><h3>Transcript</h3></div>
        <div className="card-actions">
          <a href={lesson.parentFolderId ? `https://drive.google.com/drive/u/0/folders/${lesson.parentFolderId}` : `https://drive.google.com/file/d/${lesson.id}/view`} target="_blank" rel="noreferrer">Mở thư mục Drive</a>
        </div>
      </div>
      {bundled ? (
        <div className="transcript-content">{bundled}</div>
      ) : (
        <div className="empty-panel">
          <strong>Video này chưa có transcript đã đồng bộ.</strong>
          <p>Google Drive chưa cung cấp transcript đã xử lý cho video này.</p>
        </div>
      )}
    </section>
  );
};

const QUESTION_TYPE_LABELS = {
  'multiple-choice': 'Chọn đáp án',
  'fill-blank': 'Điền từ',
  'sentence-completion': 'Hoàn thành câu',
  'short-answer': 'Trả lời ngắn',
  'long-answer': 'Tự luận',
  application: 'Vận dụng',
};

const QuizSection = ({ lesson, moduleName, bundledTranscript = '' }) => {
  const exercise = useMemo(
    () => buildExercise(moduleName, lesson, bundledTranscript),
    [moduleName, lesson, bundledTranscript],
  );
  const answerStorageKey = `courseAnswers:${lesson.id}`;
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiKey, setShowApiKey] = useState(() => !localStorage.getItem('gemini_api_key') && !DEFAULT_GEMINI_API_KEY);
  const effectiveApiKey = apiKey.trim() || DEFAULT_GEMINI_API_KEY;
  const [answers, setAnswers] = useState(() => {
    try { return JSON.parse(localStorage.getItem(answerStorageKey) || '{}'); } catch { return {}; }
  });
  const [feedback, setFeedback] = useState({});
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState('');

  if (!exercise) return null;

  const updateAnswer = (questionId, value) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    localStorage.setItem(answerStorageKey, JSON.stringify(next));
  };

  const saveApiKey = () => {
    const normalized = apiKey.trim();
    if (normalized) localStorage.setItem('gemini_api_key', normalized);
    else localStorage.removeItem('gemini_api_key');
    setApiKey(normalized);
    setShowApiKey(!normalized && !DEFAULT_GEMINI_API_KEY);
  };

  const useDefaultApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setShowApiKey(false);
  };

  const gradeAnswers = async () => {
    const unanswered = exercise.questions.filter((item) => !answers[item.id]?.trim());
    if (unanswered.length) return setError(`Bạn còn ${unanswered.length} câu chưa trả lời.`);
    if (!effectiveApiKey) {
      setShowApiKey(true);
      return setError('Hãy lưu Gemini API key trước khi chấm bài.');
    }
    setGrading(true);
    setError('');
    try {
      const transcript = bundledTranscript;
      const payload = exercise.questions.map((item) => ({ id: item.id, type: item.type, question: item.text, options: item.options, correctAnswer: item.correctAnswer, rubric: item.rubric, learnerAnswer: answers[item.id] }));
      const prompt = `Bạn là trợ giảng trên một nền tảng học trực tuyến. Chỉ chấm và giải thích câu trả lời; không tạo câu hỏi mới.
Bài học: ${exercise.title}
Transcript tham khảo (có thể trống): ${transcript.slice(0, 8000)}

Hãy chấm từng câu theo rubric, trả về JSON thuần dạng:
{"results":[{"id":"...","score":0,"verdict":"Đạt/Chưa đạt","feedback":"...","explanation":"...","improvedAnswer":"..."}]}
Điểm score từ 0 đến 10. Giải thích ngắn, cụ thể, bằng tiếng Việt. Dữ liệu cần chấm:
${JSON.stringify(payload)}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': effectiveApiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error?.message || 'Không thể chấm bài.');
      const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
      setFeedback(Object.fromEntries((parsed.results || []).map((item) => [item.id, item])));
    } catch (gradeError) {
      setError(gradeError.message || 'Có lỗi khi chấm bài. Vui lòng thử lại.');
    } finally { setGrading(false); }
  };

  return (
    <section className="learning-card quiz-card">
      <div className="card-heading">
        <div><span className="eyebrow">Bài tập cố định</span><h3>{exercise.title}</h3></div>
        <button className="text-button" onClick={() => setShowApiKey((value) => !value)}>{apiKey ? 'Đổi API key' : DEFAULT_GEMINI_API_KEY ? 'API key mặc định' : 'Thêm API key'}</button>
      </div>
      <p className="quiz-intro">Câu hỏi không thay đổi khi tải lại trang. AI chỉ được dùng sau khi bạn nộp bài để chấm và giải thích.</p>
      {showApiKey && (
        <div className="api-key-panel">
          <label htmlFor="gemini-api-key">Gemini API key</label>
          <div className="inline-form">
            <input id="gemini-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={DEFAULT_GEMINI_API_KEY ? 'Để trống để dùng key mặc định' : 'AIzaSy...'} autoComplete="off" />
            <button className="secondary-button" onClick={saveApiKey}>Lưu key</button>
            {apiKey && DEFAULT_GEMINI_API_KEY && <button className="secondary-button" onClick={useDefaultApiKey}>Dùng key mặc định</button>}
          </div>
          <small>{apiKey ? 'Key cá nhân được lưu một lần trong trình duyệt và dùng chung cho mọi video.' : DEFAULT_GEMINI_API_KEY ? 'Đang dùng key mặc định từ .env. Bạn có thể nhập key cá nhân để ghi đè.' : 'Key được lưu một lần trong trình duyệt và dùng chung cho mọi video.'}</small>
        </div>
      )}
      <div className="question-list">
        {exercise.questions.map((item, index) => {
          const result = feedback[item.id];
          return (
            <article className="question-card" key={item.id}>
              <div className="question-number">{index + 1}</div>
              <div className="question-body">
                <span className="question-type">{QUESTION_TYPE_LABELS[item.type] || 'Bài tập'}</span>
                <p>{item.text}</p>
                {item.type === 'multiple-choice' ? (
                  <div className="answer-options">
                    {item.options.map((option, optionIndex) => (
                      <label className={`answer-option ${answers[item.id] === option ? 'is-selected' : ''}`} key={`${item.id}-${optionIndex}`}>
                        <input type="radio" name={item.id} value={option} checked={answers[item.id] === option} onChange={(event) => updateAnswer(item.id, event.target.value)} />
                        <span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                ) : item.type === 'fill-blank' ? (
                  <input className="answer-input" value={answers[item.id] || ''} onChange={(event) => updateAnswer(item.id, event.target.value)} placeholder={item.placeholder} />
                ) : (
                  <textarea value={answers[item.id] || ''} onChange={(event) => updateAnswer(item.id, event.target.value)} placeholder={item.placeholder} rows={item.type === 'sentence-completion' || item.type === 'short-answer' ? 2 : 4} />
                )}
                {result && (
                  <div className={`feedback ${result.score >= 6 ? 'feedback--good' : 'feedback--review'}`}>
                    <div className="feedback-summary"><strong>{result.verdict}</strong><span>{result.score}/10</span></div>
                    <p>{result.feedback}</p><p><b>Giải thích:</b> {result.explanation}</p>
                    {result.improvedAnswer && <p><b>Gợi ý tốt hơn:</b> {result.improvedAnswer}</p>}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {error && <div className="error-message">{error}</div>}
      <button className="primary-button grade-button" onClick={gradeAnswers} disabled={grading}>{grading ? 'Đang chấm và giải thích…' : 'Chấm bài bằng AI'}</button>
    </section>
  );
};

export default function App() {
  const [courseData, setCourseData] = useState(null);
  const [syncedTranscripts, setSyncedTranscripts] = useState({});
  const [transcriptsLoading, setTranscriptsLoading] = useState(true);
  const [loading, setLoading] = useState(Boolean(WEB_APP_URL));
  const [loadError, setLoadError] = useState(() => WEB_APP_URL ? '' : 'Thiếu VITE_DRIVE_WEB_APP_URL trong .env. Không thể tải dữ liệu khóa học.');
  const [activeLesson, setActiveLesson] = useState(null);
  const [activeModule, setActiveModule] = useState('');
  const [openModules, setOpenModules] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exercisePanelOpen, setExercisePanelOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('courseTheme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}transcripts.json`)
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(setSyncedTranscripts)
      .catch(() => setSyncedTranscripts({}))
      .finally(() => setTranscriptsLoading(false));
  }, []);

  useEffect(() => {
    if (!WEB_APP_URL) {
      return undefined;
    }
    const controller = new AbortController();
    fetch(WEB_APP_URL, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((data) => {
        setCourseData(data);
        if (data.children?.length) setOpenModules({ [data.children[0].id]: true });
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setCourseData(null);
        setLoadError('Không tải được dữ liệu khóa học từ Drive API. Vui lòng tải lại trang để thử lại.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const totalLessons = useMemo(() => (courseData?.children || [])
    .reduce((total, module) => total + getAllFiles(module).length, 0), [courseData]);
  const coursePending = loading;
  const courseUnavailable = !loading && (!courseData || totalLessons === 0);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('courseTheme', next);
  };

  return (
    <div className="app-container" data-theme={theme} onKeyDown={(event) => { if (event.key === 'Escape') setExercisePanelOpen(false); }}>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <h1 className="course-title">Course Platform</h1>
            <button className="sidebar-toggle sidebar-collapse" onClick={() => setSidebarCollapsed(true)} aria-label="Ẩn danh sách bài học" title="Ẩn danh sách bài học">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          </div>
          <div className="course-total" aria-live="polite">
            {coursePending ? 'Đang tải danh sách bài học…' : courseUnavailable ? 'Chưa có dữ liệu bài học' : `Tổng ${totalLessons} bài học`}
          </div>
          {loadError && <div className="sidebar-warning">{loadError}</div>}
        </div>
        <nav className="module-list" aria-label="Nội dung khóa học">
          {coursePending ? (
            <div className="loading-skeleton" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="loader" style={{ margin: '0 auto', width: '32px', height: '32px', borderWidth: '3px' }} />
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '8px' }}>Đang đồng bộ dữ liệu...</div>
            </div>
          ) : courseUnavailable ? (
            <div className="empty-panel">Không có dữ liệu từ Drive API.</div>
          ) : (courseData?.children || []).map((module, moduleIndex) => {
            const files = getAllFiles(module); const isOpen = openModules[module.id];
            return (
              <section className="module" key={module.id || moduleIndex}>
                <button className="module-header" onClick={() => setOpenModules((current) => ({ ...current, [module.id]: !current[module.id] }))} aria-expanded={Boolean(isOpen)}>
                  <span className="module-info"><span className="module-title">Chương {moduleIndex + 1}: {module.name}</span><span className="module-meta">{files.length} bài</span></span>
                  <span className={`chevron ${isOpen ? 'open' : ''}`}>⌄</span>
                </button>
                {isOpen && <div className="lesson-list">{files.map((lesson, lessonIndex) => (
                  <button key={lesson.id} className={`lesson ${activeLesson?.id === lesson.id ? 'active' : ''}`} onClick={() => { setActiveModule(module.name); setActiveLesson(lesson); setMobileMenuOpen(false); setExercisePanelOpen(false); }}>
                    <FileIcon type={lesson.category || lesson.mime} />
                    <span className="lesson-title" title={lesson.name}>{lessonIndex + 1}. {stripExtension(lesson.name)}</span>
                  </button>
                ))}</div>}
              </section>
            );
          })}
        </nav>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMobileMenuOpen((value) => !value)} aria-label="Mở danh sách bài học">☰</button>
          {sidebarCollapsed && (
            <button className="sidebar-toggle sidebar-reveal" onClick={() => setSidebarCollapsed(false)} aria-label="Hiện danh sách bài học" title="Hiện danh sách bài học">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          )}
          <div className="content-header">{activeLesson ? <><span className="content-breadcrumb">{activeModule}</span><span className="content-title">{stripExtension(activeLesson.name)}</span></> : <span className="content-title">Chào mừng bạn quay lại!</span>}</div>
          <button className="theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z" /></svg>
            )}
          </button>
          {activeLesson?.category === 'video' && (
            <button className="exercise-toggle" onClick={() => setExercisePanelOpen(true)} aria-label="Mở bảng bài tập" title="Mở bảng bài tập" aria-haspopup="dialog" aria-expanded={exercisePanelOpen}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5h6m-6 4h6m-6 4h4m-7 7h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3.2a3 3 0 0 0-5.6 0H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
            </button>
          )}
        </header>
        <div className="player-wrapper" onClick={() => setMobileMenuOpen(false)}>
          {coursePending ? (
            <div className="empty-state"><div className="loader" style={{ opacity: 0.5 }} /><h2>Đang kết nối dữ liệu...</h2></div>
          ) : courseUnavailable ? (
            <div className="empty-state"><h2>Không tải được dữ liệu khóa học</h2><p>Kiểm tra Drive API rồi tải lại trang.</p></div>
          ) : activeLesson ? (
            <div className="lesson-workspace">
              <div className="player-container"><iframe src={`https://drive.google.com/file/d/${activeLesson.id}/preview`} className={activeLesson.category === 'pdf' ? 'pdf-frame' : 'video-frame'} allow="autoplay; fullscreen" allowFullScreen title={activeLesson.name} /></div>
              {activeLesson.category === 'video' && <div className="learning-grid learning-grid--transcript"><TranscriptSection key={`transcript-${activeLesson.id}`} lesson={activeLesson} bundled={syncedTranscripts[activeLesson.id]?.text || ''} /></div>}
            </div>
          ) : <div className="empty-state"><div className="empty-icon">▣</div><h2>Chọn một bài học để bắt đầu</h2></div>}
        </div>
      </main>
      {activeLesson?.category === 'video' && (
        <div className={`exercise-panel-backdrop ${exercisePanelOpen ? 'is-open' : ''}`} aria-hidden={!exercisePanelOpen} onMouseDown={() => setExercisePanelOpen(false)}>
          <aside className="exercise-panel" role="dialog" aria-modal="true" aria-label={`Bài tập: ${stripExtension(activeLesson.name)}`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="exercise-panel-header">
              <div><span className="eyebrow">Làm bài ngay</span><strong>{stripExtension(activeLesson.name)}</strong></div>
              <div className="exercise-panel-actions">
                <button className="theme-toggle panel-theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} title={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}>
                  {theme === 'dark' ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z" /></svg>
                  )}
                </button>
                <button className="exercise-panel-close" onClick={() => setExercisePanelOpen(false)} aria-label="Đóng bảng bài tập">×</button>
              </div>
            </div>
            <div className="exercise-panel-content">
              {transcriptsLoading ? (
                <div className="panel-loading"><span className="loader" /><strong>Đang chuẩn bị bài tập…</strong><small>Đang tải transcript và nội dung câu hỏi.</small></div>
              ) : (
                <QuizSection key={`quiz-${activeLesson.id}`} lesson={activeLesson} moduleName={activeModule} bundledTranscript={syncedTranscripts[activeLesson.id]?.text || ''} />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
