import { useEffect, useMemo, useState } from 'react';
import { buildExercise } from './exercises';

const COURSE_API_URL = '/api/course';
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

const LessonSummarySection = ({ lesson, summary }) => {
  return (
    <section className="learning-card summary-card">
      <div className="card-heading">
        <div><span className="eyebrow">Nội dung bài giảng</span><h3>Tóm tắt bài học</h3></div>
        <div className="card-actions">
          <a href={lesson.parentFolderId ? `https://drive.google.com/drive/u/0/folders/${lesson.parentFolderId}` : `https://drive.google.com/file/d/${lesson.id}/view`} target="_blank" rel="noreferrer">Mở thư mục Drive</a>
        </div>
      </div>
      {summary?.overview ? (
        <div className="lesson-summary">
          <p className="summary-overview">{summary.overview}</p>
          {summary.keyPoints?.length > 0 && (
            <div className="summary-section"><h4>Ý chính cần nhớ</h4><ul>{summary.keyPoints.map((point, index) => <li key={`${lesson.id}-summary-${index}`}>{point}</li>)}</ul></div>
          )}
          {summary.practiceFocus && <div className="summary-practice"><strong>Nên luyện tập</strong><p>{summary.practiceFocus}</p></div>}
        </div>
      ) : (
        <div className="empty-panel">
          <strong>Video này chưa có bản tóm tắt.</strong>
          <p>Nội dung tóm tắt sẽ được bổ sung sau khi transcript được xử lý.</p>
        </div>
      )}
    </section>
  );
};

const VideoPlayer = ({ lesson }) => {
  const [failedLessonId, setFailedLessonId] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);

  if (failedLessonId === lesson.id) {
    return (
      <div className="video-player-status video-player-error">
        <strong>Không thể phát video này.</strong>
        <p>Hãy thử tải lại luồng phát hoặc mở video trực tiếp trong Drive.</p>
        <div className="video-player-actions">
          <button className="primary-button" onClick={() => { setFailedLessonId(''); setRetryVersion((value) => value + 1); }}>Thử lại</button>
          <a href={`https://drive.google.com/file/d/${lesson.id}/view`} target="_blank" rel="noreferrer">Mở bằng Drive</a>
        </div>
      </div>
    );
  }

  return (
    <video
      key={`${lesson.id}-${retryVersion}`}
      className="native-video-player"
      controls
      playsInline
      preload="metadata"
      src={`/api/media?fileId=${encodeURIComponent(lesson.id)}`}
      onError={() => setFailedLessonId(lesson.id)}
    >
      Trình duyệt của bạn không hỗ trợ phát video HTML5.
    </video>
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

const QuizSection = ({ lesson, moduleName, bundledTranscript = '', inVideoExercises = {} }) => {
  const exercise = useMemo(
    () => buildExercise(moduleName, lesson, bundledTranscript, inVideoExercises),
    [moduleName, lesson, bundledTranscript, inVideoExercises],
  );
  const [activeQuestionSet, setActiveQuestionSet] = useState(() => inVideoExercises.groups?.length ? 'in-video' : 'review');
  const answerStorageKey = `courseAnswers:${lesson.id}${exercise.version ? `:${exercise.version}` : ''}`;
  const [answers, setAnswers] = useState(() => {
    try { return JSON.parse(localStorage.getItem(answerStorageKey) || '{}'); } catch { return {}; }
  });
  const [feedback, setFeedback] = useState({});
  const [gradingGroupId, setGradingGroupId] = useState('');
  const [groupErrors, setGroupErrors] = useState({});
  const [openGroups, setOpenGroups] = useState({});

  if (!exercise) return null;

  const updateAnswer = (questionId, value) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    localStorage.setItem(answerStorageKey, JSON.stringify(next));
  };

  const visibleGroups = activeQuestionSet === 'in-video'
    ? exercise.inVideoGroups
    : [{ id: 'review', title: 'Ôn tập sau video', instruction: 'Củng cố kiến thức và vận dụng nội dung chính của bài học.', questions: exercise.reviewQuestions }];

  const gradeGroup = async (group) => {
    const unanswered = group.questions.filter((item) => !answers[item.id]?.trim());
    if (unanswered.length) {
      setGroupErrors((current) => ({ ...current, [group.id]: `Bạn còn ${unanswered.length} câu chưa trả lời trong phần này.` }));
      return;
    }
    setGradingGroupId(group.id);
    setGroupErrors((current) => ({ ...current, [group.id]: '' }));
    try {
      const payload = group.questions.map((item) => ({ id: item.id, type: item.type, question: item.text, options: item.options, requiredWords: item.requiredWords, correctAnswer: item.correctAnswer, rubric: item.rubric, learnerAnswer: answers[item.id] }));
      const gradedResults = [];
      for (let offset = 0; offset < payload.length; offset += 10) {
        const response = await fetch('/api/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exerciseTitle: `${exercise.title} — ${group.title}`, transcript: bundledTranscript.slice(0, 8000), questions: payload.slice(offset, offset + 10) }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error?.message || 'Không thể chấm bài.');
        gradedResults.push(...(data.results || []));
      }
      setFeedback((current) => ({ ...current, ...Object.fromEntries(gradedResults.map((item) => [item.id, item])) }));
    } catch (gradeError) {
      setGroupErrors((current) => ({ ...current, [group.id]: gradeError.message || 'Có lỗi khi chấm bài. Vui lòng thử lại.' }));
    } finally { setGradingGroupId(''); }
  };

  return (
    <section className="learning-card quiz-card">
      <div className="card-heading">
        <div><span className="eyebrow">Bài tập cố định</span><h3>{exercise.title}</h3></div>
        <span className="ai-grading-badge">AI chấm &amp; giải thích</span>
      </div>
      <p className="quiz-intro">Câu hỏi không thay đổi khi tải lại trang. AI chỉ được dùng sau khi bạn nộp bài để chấm và giải thích.</p>
      {exercise.inVideoGroups.length > 0 && (
        <div className="exercise-tabs" role="tablist" aria-label="Loại bài tập">
          <button className={activeQuestionSet === 'review' ? 'is-active' : ''} onClick={() => setActiveQuestionSet('review')} role="tab" aria-selected={activeQuestionSet === 'review'}>
            Ôn tập sau video <span>{exercise.reviewQuestions.length}</span>
          </button>
          <button className={activeQuestionSet === 'in-video' ? 'is-active' : ''} onClick={() => setActiveQuestionSet('in-video')} role="tab" aria-selected={activeQuestionSet === 'in-video'}>
            Bài tập trong video <span>{exercise.inVideoGroups.reduce((total, group) => total + group.questions.length, 0)}</span>
          </button>
        </div>
      )}
      <div className="exercise-group-list">
        {visibleGroups.map((group, groupIndex) => {
          const grading = gradingGroupId === group.id;
          return (
            <details
              className="exercise-question-group"
              key={group.id}
              open={openGroups[group.id] ?? groupIndex === 0}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpenGroups((current) => current[group.id] === isOpen ? current : { ...current, [group.id]: isOpen });
              }}
            >
              <summary className="exercise-group-summary">
                <div className="exercise-group-title">
                  <span className="exercise-time">{activeQuestionSet === 'in-video' && group.startTime ? `~${group.startTime}` : 'Ôn tập'}</span>
                  <span>{group.title}</span>
                </div>
                <span className="exercise-group-count">{group.questions.length} câu</span>
              </summary>
              <div className="exercise-group-content">
                {group.instruction && <p className="exercise-group-instruction">{group.instruction}</p>}
                {activeQuestionSet === 'in-video' && group.answerTime && (
                  <p className="exercise-answer-time">Giảng viên bắt đầu chữa từ khoảng <strong>{group.answerTime}</strong>.</p>
                )}
                <div className="question-list">
                  {group.questions.map((item, index) => {
                    const result = feedback[item.id];
                    const isCorrect = result?.isCorrect ?? result?.verdict === 'Đúng';
                    return (
                      <article className="question-card" key={item.id}>
                        <div className="question-number">{index + 1}</div>
                        <div className="question-body">
                          <span className="question-type">{QUESTION_TYPE_LABELS[item.type] || 'Bài tập'}</span>
                          <p>{item.text}</p>
                          {item.requiredWords?.length > 0 && (
                            <div className="required-words"><span>Từ bắt buộc</span><strong>{item.requiredWords.join(', ')}</strong></div>
                          )}
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
                            <div className={`feedback ${isCorrect ? 'feedback--good' : 'feedback--review'}`}>
                              <div className="feedback-summary"><strong>{isCorrect ? 'Đúng' : 'Chưa đúng'}</strong></div>
                              {result.feedback && <p>{result.feedback}</p>}
                              {result.explanation && <p><b>{isCorrect ? 'Vì sao đúng:' : 'Vì sao chưa đúng:'}</b> {result.explanation}</p>}
                              {!isCorrect && result.referenceAnswer && <p><b>Cần sửa theo đáp án:</b> {result.referenceAnswer}</p>}
                              {!isCorrect && (result.correctedLearnerAnswer || result.improvedAnswer) && <p><b>Nếu giữ cách viết của bạn:</b> {result.correctedLearnerAnswer || result.improvedAnswer}</p>}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {groupErrors[group.id] && <div className="error-message">{groupErrors[group.id]}</div>}
                <button className="primary-button grade-button" onClick={() => gradeGroup(group)} disabled={Boolean(gradingGroupId)}>
                  {grading ? 'Đang chấm phần này…' : 'Chấm & giải thích phần này'}
                </button>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
};

export default function App() {
  const [courseData, setCourseData] = useState(null);
  const [syncedTranscripts, setSyncedTranscripts] = useState({});
  const [syncedInVideoExercises, setSyncedInVideoExercises] = useState({});
  const [lessonSummaries, setLessonSummaries] = useState({});
  const [transcriptsLoading, setTranscriptsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeLesson, setActiveLesson] = useState(null);
  const [activeModule, setActiveModule] = useState('');
  const [openModules, setOpenModules] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [exercisePanelOpen, setExercisePanelOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('courseTheme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}transcripts.json`).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }),
      fetch(`${import.meta.env.BASE_URL}in-video-exercises.json`).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }),
      fetch(`${import.meta.env.BASE_URL}lesson-summaries.json`).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }),
    ])
      .then(([transcripts, inVideo, summaries]) => { setSyncedTranscripts(transcripts); setSyncedInVideoExercises(inVideo); setLessonSummaries(summaries); })
      .catch(() => { setSyncedTranscripts({}); setSyncedInVideoExercises({}); setLessonSummaries({}); })
      .finally(() => setTranscriptsLoading(false));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(COURSE_API_URL, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((data) => {
        setCourseData(data);
        if (data.children?.length) setOpenModules({ [data.children[0].id]: true });
        fetch('/api/media?warm=1').catch(() => {});
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

  const openExercisePanel = () => {
    setSidebarCollapsed(true);
    setMobileMenuOpen(false);
    setExercisePanelOpen(true);
  };

  return (
    <div className={`app-container ${exercisePanelOpen ? 'exercise-mode' : ''}`} data-theme={theme} onKeyDown={(event) => { if (event.key === 'Escape') setExercisePanelOpen(false); }}>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <h1 className="course-title">Course Platform</h1>
            <button className="sidebar-toggle sidebar-collapse" onClick={() => setSidebarCollapsed(true)} aria-label="Ẩn danh sách bài học" title="Ẩn danh sách bài học">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button className="sidebar-toggle sidebar-mobile-close" onClick={() => setMobileMenuOpen(false)} aria-label="Đóng danh sách bài học" title="Đóng danh sách bài học">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
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
            <button className="exercise-toggle" onClick={openExercisePanel} aria-label="Mở bảng bài tập" title="Mở bảng bài tập" aria-haspopup="dialog" aria-expanded={exercisePanelOpen}>
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
            <div className={`lesson-workspace ${activeLesson.category === 'video' ? 'lesson-workspace--video' : ''}`}>
              <div className="player-container">
                {activeLesson.category === 'video'
                  ? <VideoPlayer lesson={activeLesson} />
                  : <iframe src={`https://drive.google.com/file/d/${activeLesson.id}/preview`} className="pdf-frame" title={activeLesson.name} />}
              </div>
              {activeLesson.category === 'video' && <div className="learning-grid learning-grid--summary"><LessonSummarySection key={`summary-${activeLesson.id}`} lesson={activeLesson} summary={lessonSummaries[activeLesson.id]} /></div>}
            </div>
          ) : <div className="empty-state"><div className="empty-icon">▣</div><h2>Chọn một bài học để bắt đầu</h2></div>}
        </div>
      </main>
      {activeLesson?.category === 'video' && (
        <div className={`exercise-panel-backdrop ${exercisePanelOpen ? 'is-open' : ''}`} aria-hidden={!exercisePanelOpen}>
          <aside className="exercise-panel" role="dialog" aria-modal="false" aria-label={`Bài tập: ${stripExtension(activeLesson.name)}`}>
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
                <div className="panel-loading"><span className="loader" /><strong>Đang chuẩn bị bài tập…</strong><small>Đang tải nội dung bài học và câu hỏi.</small></div>
              ) : (
                <QuizSection key={`quiz-${activeLesson.id}`} lesson={activeLesson} moduleName={activeModule} bundledTranscript={syncedTranscripts[activeLesson.id]?.text || ''} inVideoExercises={syncedInVideoExercises[activeLesson.id] || {}} />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
