import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAX_FILES = 2;
const MAX_IMAGE_SIDE = 1800;
const JPEG_QUALITY = 0.84;
const KAKAO_LINK = 'https://open.kakao.com/o/sIycgvDi';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function resultIsClean(result) {
  const problems = Array.isArray(result?.problems) ? result.problems : [];
  return problems.length > 0 && problems.every((problem) => problem?.verdict === '맞음');
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

function getVerdictClass(verdict) {
  if (verdict === '맞음') return 'ok';
  if (verdict === '틀림') return 'bad';
  if (verdict === '판독 불가') return 'neutral';
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

function ResultCard({ item, onCopy }) {
  const problems = Array.isArray(item.result?.problems) ? item.result.problems : [];

  if (!problems.length) {
    return <div className="errorBox small">분석 결과를 표시하지 못했습니다.</div>;
  }

  return (
    <div className="result">
      {problems.map((problem, index) => {
        const number = String(problem?.number || index + 1).trim();
        const verdict = problem?.verdict || '확인 필요';
        const message = String(problem?.message || verdict).trim();
        const showMessage = message && message !== verdict && !(verdict === '맞음' && message === '맞음');

        return (
          <div className="resultBlock" key={`${number}-${index}`}>
            <div className="resultHeading">
              <span className="problemNumber">{number}번</span>
              <div className={`verdict ${getVerdictClass(verdict)}`}>{verdict}</div>
            </div>
            {showMessage && <p>{message}</p>}
          </div>
        );
      })}

      <button className="copy" onClick={onCopy}>
        <span>결과 복사</span>
        <span aria-hidden="true">⧉</span>
      </button>
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

    for (const item of items) {
      try {
        const result = await analyzeOne(item);
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'done', result, error: '' } : x));
      } catch (error) {
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'error', error: error.message || '분석 실패' } : x));
      }
    }

    setBusy(false);
  }

  function copyResult(item) {
    const problems = Array.isArray(item.result?.problems) ? item.result.problems : [];
    if (!problems.length) return;

    const lines = problems.map((problem, index) => {
      const number = String(problem?.number || index + 1).trim();
      const verdict = problem?.verdict || '확인 필요';
      const message = String(problem?.message || verdict).trim();
      return message && message !== verdict
        ? `${number}번: ${verdict} - ${message}`
        : `${number}번: ${verdict}`;
    });

    navigator.clipboard.writeText(lines.join('\n'));
  }

  const cleanCount = items.filter((x) => resultIsClean(x.result)).length;
  const reviewCount = items.filter((x) => x.result && !resultIsClean(x.result)).length;

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark" aria-hidden="true">✓</div>
          <div>
            <strong>풀이체커</strong>
            <span>AI Math Checker</span>
          </div>
        </div>

        <a className="kakaoButton" href={KAKAO_LINK} target="_blank" rel="noreferrer noopener">
          <span className="kakaoDot" aria-hidden="true" />
          문의하기
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <div className="appContent">
        <section className="heroCard">
          <div className="heroCopy">
            <span className="betaPill">무료 베타</span>
            <h1>학생 풀이,<br /><em>틀린 곳만 빠르게</em></h1>
            <p>사진을 올리면 맞음·틀림을 문제별로 판정하고, 틀린 경우 최초 오류만 간단히 알려드립니다.</p>

            <div className="featurePills">
              <span>최대 2장</span>
              <span>문제별 판정</span>
              <span>회원가입 없음</span>
            </div>
          </div>

          <div className="heroPreview" aria-hidden="true">
            <div className="previewSheet">
              <span className="previewLine long" />
              <span className="previewLine" />
              <span className="previewLine medium" />
              <div className="previewResult ok">✓ 맞음</div>
              <div className="previewResult bad">! 부호 오류</div>
            </div>
          </div>
        </section>

        <section className="workspaceCard">
          <div className="sectionHeading">
            <div>
              <span className="stepLabel">STEP 1</span>
              <h2>풀이 사진 올리기</h2>
              <p>한 번에 최대 2장까지 분석할 수 있어요.</p>
            </div>
            <span className="fileCounter">{items.length}/{MAX_FILES}</span>
          </div>

          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          >
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <div className="uploadIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <path d="M7 7.5h1.2l1-1.7h5.6l1 1.7H17a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6.5a3 3 0 0 1 3-3Z" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
            </div>
            <h3>사진 선택 또는 촬영</h3>
            <p>문제와 학생 풀이가 함께 보이도록 선명하게 찍어주세요.</p>
            <button type="button" className="selectButton">사진 불러오기</button>
          </div>

          <div className="uploadGuide">
            <span>✓ 세로·가로 사진 모두 가능</span>
            <span>✓ JPG·PNG 지원</span>
            <span>✓ 업로드 전 자동 압축</span>
          </div>
        </section>

        <div className="actions">
          <button className="primary" disabled={!canAnalyze} onClick={analyzeAll}>
            <span>{busy ? '분석 중...' : '전체 분석'}</span>
            <span aria-hidden="true">→</span>
          </button>
          <button className="ghost" disabled={busy || !items.length} onClick={clearAll}>전체 삭제</button>
        </div>

        {items.some((x) => x.result) && (
          <section className="summary">
            <div><b>{items.length}</b><span>전체</span></div>
            <div><b>{cleanCount}</b><span>맞음</span></div>
            <div><b>{reviewCount}</b><span>확인 필요</span></div>
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
                  <div>
                    <span className="cardIndex">PHOTO {String(idx + 1).padStart(2, '0')}</span>
                    <strong>학생 풀이 {idx + 1}</strong>
                  </div>
                  <button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button>
                </div>
                <p className="meta">{item.name} · {formatBytes(item.size)}</p>

                {item.status === 'ready' && <p className="muted">분석할 준비가 됐어요.</p>}
                {item.status === 'compressing' && <p className="muted loadingText">이미지 전송 준비 중...</p>}
                {item.status === 'analyzing' && <p className="muted loadingText">AI가 풀이를 검산하고 있어요...</p>}
                {item.status === 'error' && <div className="errorBox small">{item.error}</div>}

                {item.result && <ResultCard item={item} onCopy={() => copyResult(item)} />}
              </div>
            </article>
          ))}
        </section>

        {!items.length && (
          <section className="emptyState">
            <div className="emptyIcon" aria-hidden="true">⌁</div>
            <strong>아직 올린 사진이 없어요</strong>
            <p>위의 사진 업로드 버튼을 눌러 풀이 사진을 추가하세요.</p>
          </section>
        )}

        <footer className="footerNote">
          <p>AI 분석 결과는 보조 자료입니다. 중요한 판정은 직접 한 번 더 확인해 주세요.</p>
          <a href={KAKAO_LINK} target="_blank" rel="noreferrer noopener">오류 제보 및 문의</a>
        </footer>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
