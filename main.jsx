import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAX_FILES = 8;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Badge({ children, type = 'neutral' }) {
  return <span className={`badge ${type}`}>{children}</span>;
}

function ResultCard({ result, index }) {
  if (!result) return null;

  const isCorrect = result.verdict === '맞음';
  const needsReview = result.verdict === '확인 필요';

  return (
    <div className="result-card">
      <div className="result-head">
        <strong>사진 {index + 1}</strong>
        {isCorrect && <Badge type="ok">✅ 풀이 맞음</Badge>}
        {!isCorrect && !needsReview && <Badge type="bad">❌ 풀이 틀림</Badge>}
        {needsReview && <Badge type="warn">⚠️ 확인 필요</Badge>}
      </div>

      <div className="result-section">
        <h4>계산 실수</h4>
        {result.calculation_errors?.length ? (
          <ul>
            {result.calculation_errors.map((err, i) => (
              <li key={i}>
                <b>{err.line || '위치 미상'}</b>
                <div className="wrong">학생: {err.student || '-'}</div>
                <div className="right">수정: {err.correct || '-'}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p>없음</p>
        )}
      </div>

      {result.logic_leaps?.length ? (
        <div className="result-section logic-alert">
          <h4>🔴 논리 비약 발견</h4>
          <ul>
            {result.logic_leaps.map((item, i) => (
              <li key={i}>
                <b>{item.line || '위치 미상'}</b>
                <div>{item.reason || '선생님 확인 필요'}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.note ? <p className="note">{result.note}</p> : null}
    </div>
  );
}

function App() {
  const [items, setItems] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');

  const canAnalyze = items.length > 0 && !isAnalyzing;

  async function addFiles(fileList) {
    setError('');
    const files = Array.from(fileList)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, MAX_FILES - items.length);

    if (!files.length) return;

    const next = await Promise.all(
      files.map(async (file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        name: file.name,
        dataUrl: await fileToDataUrl(file),
        result: null,
        status: 'ready',
      }))
    );

    setItems((prev) => [...prev, ...next]);
  }

  async function analyzeAll() {
    if (!canAnalyze) return;
    setIsAnalyzing(true);
    setError('');
    setItems((prev) => prev.map((item) => ({ ...item, status: 'analyzing', result: null })));

    try {
      const response = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: items.map((item) => item.dataUrl) }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '분석 실패');

      setItems((prev) =>
        prev.map((item, index) => ({
          ...item,
          status: 'done',
          result: data.results?.[index] || {
            verdict: '확인 필요',
            calculation_errors: [],
            logic_leaps: [],
            note: '결과를 받지 못했습니다.',
          },
        }))
      );
    } catch (err) {
      setError(err.message || '분석 중 오류가 발생했습니다.');
      setItems((prev) => prev.map((item) => ({ ...item, status: 'ready' })));
    } finally {
      setIsAnalyzing(false);
    }
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function reset() {
    setItems([]);
    setError('');
  }

  const summary = useMemo(() => {
    const done = items.filter((item) => item.result);
    const wrong = done.filter((item) => item.result.verdict !== '맞음').length;
    return { done: done.length, wrong };
  }, [items]);

  return (
    <main className="app">
      <section className="hero">
        <div>
          <p className="eyebrow">Teacher AI Tool</p>
          <h1>풀이체커</h1>
          <p className="subtitle">학생 풀이 사진을 올리면 계산 실수와 빨간색 수준의 논리 비약만 빠르게 확인합니다.</p>
        </div>
        <button className="ghost" onClick={reset} disabled={!items.length || isAnalyzing}>초기화</button>
      </section>

      <section
        className={`uploader ${isDragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <input
          id="file-input"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => addFiles(e.target.files)}
        />
        <label htmlFor="file-input">
          <span className="camera">📷</span>
          <strong>사진 선택 또는 드래그</strong>
          <small>최대 {MAX_FILES}장까지 업로드 가능</small>
        </label>
      </section>

      <div className="actions">
        <button className="primary" onClick={analyzeAll} disabled={!canAnalyze}>
          {isAnalyzing ? '분석 중...' : 'AI 분석하기'}
        </button>
        {summary.done > 0 && <span className="summary">분석 {summary.done}장 / 확인 필요 {summary.wrong}장</span>}
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        {items.map((item, index) => (
          <article className="card" key={item.id}>
            <div className="image-wrap">
              <img src={item.dataUrl} alt={item.name} />
              <button onClick={() => removeItem(item.id)} disabled={isAnalyzing}>×</button>
            </div>
            <div className="card-body">
              <div className="file-row">
                <span>{item.name}</span>
                <Badge type={item.status === 'done' ? 'ok' : item.status === 'analyzing' ? 'warn' : 'neutral'}>
                  {item.status === 'done' ? '완료' : item.status === 'analyzing' ? '분석 중' : '대기'}
                </Badge>
              </div>
              <ResultCard result={item.result} index={index} />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
