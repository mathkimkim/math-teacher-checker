import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAX_FILES = 6;
const MAX_IMAGE_SIDE = 2200;
const JPEG_QUALITY = 0.92;
const ANALYSIS_CONCURRENCY = 2;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function resultIsClean(result) {
  return result?.verdict === '맞음';
}

function statusLabel(status) {
  switch (status) {
    case 'ready': return '대기';
    case 'compressing': return '준비중';
    case 'analyzing': return '분석중';
    case 'done': return '완료';
    case 'error': return '오류';
    default: return '대기';
  }
}

function getVerdictClass(result) {
  if (!result) return '';
  if (result.verdict === '맞음') return 'ok';
  if (result.verdict === '틀림') return 'bad';
  if (result.verdict === '판독 불가') return 'neutral';
  return 'warn';
}

function compressImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);

        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve(dataUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지를 읽지 못했습니다. JPG/PNG 파일로 다시 시도하세요.'));
    };

    img.src = objectUrl;
  });
}

function ResultCard({ item }) {
  const result = item.result;
  if (!result) return null;

  const message = result.verdict === '맞음'
    ? '맞음'
    : (result.message || result.verdict || '확인 필요');

  return (
    <div className="result">
      <div className={`verdict ${getVerdictClass(result)}`}>
        {message}
      </div>
    </div>
  );
}

function App() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  }

  async function analyzeOne(item) {
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'compressing', error: '', result: null } : x));

    const imageDataUrl = await compressImageToDataUrl(item.file);

    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'analyzing' } : x));

    const res = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, fileName: item.name })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const help = data?.help ? `\n${data.help}` : '';
      throw new Error(`${data?.error || `분석 실패 (${res.status})`}${help}`);
    }
    return data;
  }

  async function analyzeAll() {
    if (!items.length || busy) return;
    setBusy(true);

    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        try {
          const result = await analyzeOne(item);
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'done', result, error: '' } : x));
        } catch (error) {
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'error', error: error.message || '분석 실패' } : x));
        }
      }
    }

    const workerCount = Math.min(ANALYSIS_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    setBusy(false);
  }


  const cleanCount = items.filter((x) => resultIsClean(x.result)).length;
  const reviewCount = items.filter((x) => x.result && !resultIsClean(x.result)).length;

  return (
    <main className="app">
      <section className="hero">
        <div>
          <p className="eyebrow">Teacher AI Math Checker</p>
          <h1>풀이체커</h1>
          <p className="sub">학생 풀이가 맞으면 맞음만, 틀리면 처음 틀린 위치만 보여줍니다.</p>
        </div>
        <div className="badge">Day3 누적 버전</div>
      </section>

      <section
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <div className="uploadIcon">📷</div>
        <h2>사진 업로드</h2>
        <p>클릭하거나 이미지를 드래그하세요. 최대 {MAX_FILES}장까지 가능.</p>
        <small>업로드 전 이미지를 자동으로 줄여 API 사용량을 줄입니다.</small>
      </section>

      <div className="actions">
        <button className="primary" disabled={!canAnalyze} onClick={analyzeAll}>{busy ? '분석 중...' : '전체 분석'}</button>
        <button className="ghost" disabled={busy || !items.length} onClick={clearAll}>전체 삭제</button>
      </div>

      {items.some((x) => x.result) && (
        <section className="summary">
          <div><b>{items.length}</b><span>전체</span></div>
          <div><b>{cleanCount}</b><span>정상</span></div>
          <div><b>{reviewCount}</b><span>틀림·확인</span></div>
        </section>
      )}

      <section className="grid">
        {items.map((item, idx) => (
          <article className="card" key={item.id}>
            <div className="thumbWrap">
              <img src={item.preview} alt={item.name} />
              <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
            </div>
            <div className="cardBody">
              <div className="row between">
                <strong>학생 풀이 {idx + 1}</strong>
                <button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button>
              </div>
              <p className="meta">{item.name} · {formatBytes(item.size)}</p>

              {item.status === 'ready' && <p className="muted">분석 대기 중</p>}
              {item.status === 'compressing' && <p className="muted">이미지 전송 준비 중...</p>}
              {item.status === 'analyzing' && <p className="muted">AI가 최초 오류 지점을 확인하는 중...</p>}
              {item.status === 'error' && <div className="errorBox small">{item.error}</div>}

              {item.result && <ResultCard item={item} />}
            </div>
          </article>
        ))}
      </section>

      {!items.length && <p className="empty">아직 업로드된 사진이 없습니다.</p>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
