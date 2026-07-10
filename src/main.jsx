import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAX_FILES = 6;
const MAX_IMAGE_SIDE = 1800;
const JPEG_QUALITY = 0.84;
const CLIENT_TIMEOUT_MS = 60000;

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function resultIsClean(result) {
  return result?.verdict === '맞음' && !result?.has_calculation_mistakes && !result?.has_logical_gaps;
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

function localErrorInfo(status, data = {}, rawMessage = '') {
  const msg = String(data?.error || data?.message || rawMessage || '').trim();
  const lower = msg.toLowerCase();
  const code = data?.code || data?.error_code || String(status || 'UNKNOWN');

  if (status === 401 || status === 403 || lower.includes('api key') || lower.includes('unauthorized')) {
    return {
      title: 'API 인증 실패',
      cause: 'OpenAI API 키가 없거나 유효하지 않습니다.',
      suggestions: ['Netlify 환경변수 OPENAI_API_KEY를 확인하세요.', '키를 새로 발급했다면 Netlify에서 다시 배포하세요.'],
      code,
      retryable: false
    };
  }

  if (status === 402 || lower.includes('quota') || lower.includes('billing') || lower.includes('credit')) {
    return {
      title: 'API 크레딧 또는 결제 한도 부족',
      cause: 'OpenAI API 잔액이 없거나 사용 한도에 도달했습니다.',
      suggestions: ['OpenAI Platform의 Billing과 Limits를 확인하세요.', '크레딧 충전 후 3~5분 뒤 다시 분석하세요.'],
      code,
      retryable: true
    };
  }

  if (status === 429) {
    return {
      title: '요청이 너무 많습니다',
      cause: '짧은 시간에 요청이 몰려 OpenAI가 일시적으로 제한했습니다.',
      suggestions: ['10~30초 후 다시 분석하세요.', '여러 장이면 한 장씩 분석해보세요.'],
      code,
      retryable: true
    };
  }

  if (status === 504 || lower.includes('timeout') || lower.includes('시간 초과')) {
    return {
      title: '분석 시간이 초과되었습니다',
      cause: 'OpenAI 응답 또는 Netlify 서버 처리 시간이 제한을 넘었습니다.',
      suggestions: ['잠시 후 다시 분석하세요.', '사진을 한 장씩 분석하세요.', '사진에서 풀이 부분만 잘라 다시 올리면 더 빨라집니다.'],
      code,
      retryable: true
    };
  }

  if (status === 413 || lower.includes('too large') || lower.includes('payload')) {
    return {
      title: '이미지 용량이 너무 큽니다',
      cause: '전송 가능한 요청 크기를 초과했습니다.',
      suggestions: ['사진을 잘라서 다시 올리세요.', '한 번에 올리는 사진 수를 줄이세요.'],
      code,
      retryable: true
    };
  }

  if (status === 400 && (lower.includes('image') || lower.includes('이미지'))) {
    return {
      title: '이미지를 읽을 수 없습니다',
      cause: msg || '지원하지 않는 이미지이거나 이미지 데이터가 손상되었습니다.',
      suggestions: ['JPG 또는 PNG로 다시 저장하세요.', '사진을 새로 촬영해 다시 올리세요.'],
      code,
      retryable: true
    };
  }

  if (status >= 500) {
    return {
      title: '서버에서 분석하지 못했습니다',
      cause: msg || 'OpenAI 또는 Netlify 서버에 일시적인 문제가 발생했습니다.',
      suggestions: ['잠시 후 다시 분석하세요.', '문제가 계속되면 Netlify Functions 로그를 확인하세요.'],
      code,
      retryable: true
    };
  }

  return {
    title: '분석에 실패했습니다',
    cause: msg || '인터넷 연결 또는 서버 응답을 확인할 수 없습니다.',
    suggestions: ['인터넷 연결을 확인하세요.', '잠시 후 다시 분석하세요.'],
    code,
    retryable: true
  };
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
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
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

function MistakeList({ title, type, items, emptyText }) {
  if (!items?.length) {
    return <div className="resultBlock cleanBlock"><span>{title}</span><p>{emptyText}</p></div>;
  }

  return (
    <div className={`resultBlock ${type}`}>
      <span>{title}</span>
      <ol className="issueList">
        {items.map((item, index) => (
          <li key={index}>
            {type === 'calc' ? (
              <>
                <b>{item.line || '위치 확인 필요'}</b>
                <div className="expr wrong">학생: {item.student_expression || '-'}</div>
                <div className="expr correct">수정: {item.correct_expression || '-'}</div>
                {item.reason && <p>{item.reason}</p>}
              </>
            ) : (
              <>
                <b>{item.line || '위치 확인 필요'}</b>
                <p>{item.issue || '선생님 확인이 필요한 논리 비약이 있습니다.'}</p>
                {item.needed_step && <div className="expr correct">필요 과정: {item.needed_step}</div>}
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ResultCard({ item, onCopy }) {
  const r = item.result;
  if (!r) return null;
  const clean = resultIsClean(r);

  return (
    <div className="result">
      <div className={`verdict ${getVerdictClass(r)}`}>{r.display_verdict || '⚠️ 풀이 확인 필요'}</div>
      {clean ? <div className="oneLine">계산 실수 없음</div> : (
        <>
          <MistakeList title="계산 실수" type="calc" items={r.calculation_mistakes} emptyText="없음" />
          {r.logical_gaps?.length > 0 && <MistakeList title="🔴 논리 비약 발견" type="logic" items={r.logical_gaps} emptyText="" />}
        </>
      )}
      {r.teacher_note && <div className="teacherNote">{r.teacher_note}</div>}
      <div className="resultMeta"><span>판독: {r.readability || '보통'}</span><span>확신도: {r.confidence ?? 0}%</span></div>
      <button className="copy" onClick={onCopy}>결과 복사</button>
    </div>
  );
}

function ErrorPanel({ errorInfo, onRetry, disabled }) {
  if (!errorInfo) return null;
  return (
    <section className="errorPanel" aria-live="polite">
      <div className="errorTitleRow"><strong>❌ {errorInfo.title}</strong><span>{errorInfo.code}</span></div>
      <div className="errorSection"><b>원인</b><p>{errorInfo.cause}</p></div>
      {!!errorInfo.suggestions?.length && (
        <div className="errorSection"><b>해결 방법</b><ul>{errorInfo.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      )}
      {errorInfo.retryable && <button className="retry" disabled={disabled} onClick={onRetry}>{disabled ? '분석 중...' : '다시 분석'}</button>}
    </section>
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
      file, name: file.name, size: file.size,
      preview: URL.createObjectURL(file),
      status: 'ready', result: null, errorInfo: null
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
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'compressing', errorInfo: null, result: null } : x));
    let imageDataUrl;
    try {
      imageDataUrl = await compressImageToDataUrl(item.file);
    } catch (error) {
      throw { status: 400, data: { error: error.message }, errorInfo: localErrorInfo(400, { error: error.message }) };
    }

    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'analyzing' } : x));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, fileName: item.name }),
        signal: controller.signal
      });

      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `분석 실패 (${res.status})` }; }
      if (!res.ok) throw { status: res.status, data, errorInfo: data.error_info || localErrorInfo(res.status, data) };
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw { status: 504, data: { error: '브라우저 대기 시간이 초과되었습니다.' }, errorInfo: localErrorInfo(504, {}, '시간 초과') };
      }
      if (error?.errorInfo) throw error;
      throw { status: 0, data: { error: error?.message || '네트워크 오류' }, errorInfo: localErrorInfo(0, {}, error?.message) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runItem(item) {
    try {
      const result = await analyzeOne(item);
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'done', result, errorInfo: null } : x));
    } catch (error) {
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'error', errorInfo: error.errorInfo || localErrorInfo(error.status, error.data) } : x));
    }
  }

  async function analyzeAll() {
    if (!items.length || busy) return;
    setBusy(true);
    for (const item of items) await runItem(item);
    setBusy(false);
  }

  async function retryItem(id) {
    if (busy) return;
    const item = items.find((x) => x.id === id);
    if (!item) return;
    setBusy(true);
    await runItem(item);
    setBusy(false);
  }

  function copyResult(item) {
    const r = item.result;
    if (!r) return;
    const lines = [r.display_verdict || '⚠️ 풀이 확인 필요'];
    if (r.calculation_mistakes?.length) {
      lines.push('', '계산 실수');
      r.calculation_mistakes.forEach((m, i) => {
        lines.push(`${i + 1}. ${m.line || ''}`.trim(), `학생: ${m.student_expression || '-'}`, `수정: ${m.correct_expression || '-'}`);
      });
    } else lines.push('', '계산 실수: 없음');
    if (r.logical_gaps?.length) {
      lines.push('', '🔴 논리 비약 발견');
      r.logical_gaps.forEach((g, i) => {
        lines.push(`${i + 1}. ${g.line || ''} ${g.issue || ''}`.trim());
        if (g.needed_step) lines.push(`필요 과정: ${g.needed_step}`);
      });
    }
    if (r.teacher_note) lines.push('', `메모: ${r.teacher_note}`);
    navigator.clipboard.writeText(lines.join('\n').trim());
  }

  const cleanCount = items.filter((x) => resultIsClean(x.result)).length;
  const reviewCount = items.filter((x) => x.result && !resultIsClean(x.result)).length;

  return (
    <main className="app">
      <section className="hero">
        <div>
          <p className="eyebrow">Teacher AI Math Checker</p>
          <h1>풀이체커</h1>
          <p className="sub">학생 풀이 사진을 올리면 계산 실수와 빨간색급 논리 비약만 표시합니다. 실패하면 원인과 해결 방법을 안내합니다.</p>
        </div>
        <div className="badge">Day4 최종 버전</div>
      </section>

      <section className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <div className="uploadIcon">📷</div><h2>사진 업로드</h2>
        <p>클릭하거나 이미지를 드래그하세요. 최대 {MAX_FILES}장까지 가능.</p>
        <small>업로드 전 이미지를 자동으로 줄여 API 사용량을 줄입니다.</small>
      </section>

      <div className="actions">
        <button className="primary" disabled={!canAnalyze} onClick={analyzeAll}>{busy ? '분석 중...' : '전체 분석'}</button>
        <button className="ghost" disabled={busy || !items.length} onClick={clearAll}>전체 삭제</button>
      </div>

      {items.some((x) => x.result) && <section className="summary"><div><b>{items.length}</b><span>전체</span></div><div><b>{cleanCount}</b><span>정상</span></div><div><b>{reviewCount}</b><span>확인 필요</span></div></section>}

      <section className="grid">
        {items.map((item, idx) => (
          <article className="card" key={item.id}>
            <div className="thumbWrap"><img src={item.preview} alt={item.name} /><span className={`status ${item.status}`}>{statusLabel(item.status)}</span></div>
            <div className="cardBody">
              <div className="row between"><strong>학생 풀이 {idx + 1}</strong><button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button></div>
              <p className="meta">{item.name} · {formatBytes(item.size)}</p>
              {item.status === 'ready' && <p className="muted">분석 대기 중</p>}
              {item.status === 'compressing' && <div className="progressLine"><span></span><p>이미지 전송 준비 중...</p></div>}
              {item.status === 'analyzing' && <div className="progressLine active"><span></span><p>AI가 계산 실수와 논리 비약을 확인하는 중...</p></div>}
              {item.status === 'error' && <ErrorPanel errorInfo={item.errorInfo} disabled={busy} onRetry={() => retryItem(item.id)} />}
              {item.result && <ResultCard item={item} onCopy={() => copyResult(item)} />}
            </div>
          </article>
        ))}
      </section>
      {!items.length && <p className="empty">아직 업로드된 사진이 없습니다.</p>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
