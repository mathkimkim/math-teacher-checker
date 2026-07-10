import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAX_FILES = 6;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function App() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const inputRef = useRef(null);

  const canAnalyze = useMemo(() => items.length > 0 && !busy, [items, busy]);

  function addFiles(fileList) {
    const imageFiles = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    const slots = Math.max(0, MAX_FILES - items.length);
    const selected = imageFiles.slice(0, slots);
    if (!selected.length) return;

    const next = selected.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      name: file.name,
      size: file.size,
      preview: URL.createObjectURL(file),
      status: 'ready',
      result: null,
      error: ''
    }));
    setItems((prev) => [...prev, ...next]);
  }

  function removeItem(id) {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((x) => x.id !== id);
    });
  }

  function clearAll() {
    items.forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
    setItems([]);
    setGlobalError('');
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function analyzeAll() {
    if (!items.length || busy) return;
    setBusy(true);
    setGlobalError('');

    for (const item of items) {
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'analyzing', error: '', result: null } : x));
      try {
        const imageDataUrl = await fileToDataUrl(item.file);
        const res = await fetch('/.netlify/functions/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl, fileName: item.name })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `분석 실패 (${res.status})`);
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'done', result: data, error: '' } : x));
      } catch (error) {
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'error', error: error.message || '분석 실패' } : x));
      }
    }

    setBusy(false);
  }

  function copyResult(item) {
    const r = item.result;
    if (!r) return;
    const text = [
      r.verdict || '',
      '',
      `계산 실수: ${r.calculation_mistakes || '없음'}`,
      r.logic_gap ? `\n🔴 논리 비약 발견\n${r.logic_gap}` : '',
      r.note ? `\n메모: ${r.note}` : ''
    ].join('\n').trim();
    navigator.clipboard.writeText(text);
  }

  return (
    <main className="app">
      <section className="hero">
        <div>
          <p className="eyebrow">Teacher AI Math Checker</p>
          <h1>풀이체커</h1>
          <p className="sub">학생 풀이 사진을 올리면 계산 실수와 빨간색급 논리 비약만 빠르게 확인합니다.</p>
        </div>
        <div className="badge">Day2 배포 안정 버전</div>
      </section>

      <section
        className="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <div className="uploadIcon">📷</div>
        <h2>사진 업로드</h2>
        <p>클릭하거나 이미지를 드래그하세요. 최대 {MAX_FILES}장까지 가능.</p>
      </section>

      <div className="actions">
        <button className="primary" disabled={!canAnalyze} onClick={analyzeAll}>{busy ? '분석 중...' : '전체 분석'}</button>
        <button className="ghost" disabled={busy || !items.length} onClick={clearAll}>전체 삭제</button>
      </div>

      {globalError && <div className="errorBox">{globalError}</div>}

      <section className="grid">
        {items.map((item, idx) => (
          <article className="card" key={item.id}>
            <div className="thumbWrap">
              <img src={item.preview} alt={item.name} />
              <span className={`status ${item.status}`}>{item.status === 'ready' ? '대기' : item.status === 'analyzing' ? '분석중' : item.status === 'done' ? '완료' : '오류'}</span>
            </div>
            <div className="cardBody">
              <div className="row between">
                <strong>학생 풀이 {idx + 1}</strong>
                <button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button>
              </div>
              <p className="meta">{item.name} · {formatBytes(item.size)}</p>

              {item.status === 'ready' && <p className="muted">분석 대기 중</p>}
              {item.status === 'analyzing' && <p className="muted">AI가 풀이를 확인하는 중...</p>}
              {item.status === 'error' && <div className="errorBox small">{item.error}</div>}

              {item.result && (
                <div className="result">
                  <div className={item.result.verdict?.includes('틀림') || item.result.verdict?.includes('확인') ? 'verdict warn' : 'verdict ok'}>
                    {item.result.verdict || '판정 없음'}
                  </div>
                  <div className="resultBlock">
                    <span>계산 실수</span>
                    <p>{item.result.calculation_mistakes || '없음'}</p>
                  </div>
                  {item.result.logic_gap && (
                    <div className="resultBlock logic">
                      <span>🔴 논리 비약 발견</span>
                      <p>{item.result.logic_gap}</p>
                    </div>
                  )}
                  {item.result.note && (
                    <div className="resultBlock">
                      <span>메모</span>
                      <p>{item.result.note}</p>
                    </div>
                  )}
                  <button className="copy" onClick={() => copyResult(item)}>결과 복사</button>
                </div>
              )}
            </div>
          </article>
        ))}
      </section>

      {!items.length && <p className="empty">아직 업로드된 사진이 없습니다.</p>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
