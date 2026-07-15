import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cropper } from 'react-cropper';
import { createClient } from '@supabase/supabase-js';
import 'cropperjs/dist/cropper.css';
import './styles.css';

const MAX_FILES = 6;
const MAX_IMAGE_SIDE = 1800;
const JPEG_QUALITY = 0.84;
const KAKAO_LINK = 'https://open.kakao.com/o/sIycgvDi';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://nkoooncnmxabzoajsdpa.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_y2AZkWT-bGUVtf5s6IyPcw_juPAYzUU';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

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




function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', reject);
    image.src = url;
  });
}

function getRadianAngle(degreeValue) {
  return (degreeValue * Math.PI) / 180;
}

function getRotatedSize(width, height, rotation) {
  const angle = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(angle) * width) + Math.abs(Math.sin(angle) * height),
    height: Math.abs(Math.sin(angle) * width) + Math.abs(Math.cos(angle) * height)
  };
}

async function cropImageToFile(imageSrc, pixelCrop, rotation, originalName) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const rotated = getRotatedSize(image.width, image.height, rotation);

  canvas.width = Math.round(rotated.width);
  canvas.height = Math.round(rotated.height);
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(getRadianAngle(rotation));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(pixelCrop.width));
  output.height = Math.max(1, Math.round(pixelCrop.height));
  const outputCtx = output.getContext('2d');
  outputCtx.drawImage(
    canvas,
    Math.round(pixelCrop.x),
    Math.round(pixelCrop.y),
    Math.round(pixelCrop.width),
    Math.round(pixelCrop.height),
    0,
    0,
    output.width,
    output.height
  );

  const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('자른 이미지를 만들지 못했습니다.');
  const baseName = String(originalName || 'photo').replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}-cropped.jpg`, { type: 'image/jpeg' });
}

function normalizeErrorPayload(data, status) {
  const solutions = Array.isArray(data?.solution)
    ? data.solution.filter(Boolean)
    : [data?.help].filter(Boolean);

  return {
    title: data?.title || data?.error || `분석 실패 (${status})`,
    reason: data?.reason || '요청을 처리하는 중 오류가 발생했습니다.',
    solutions: solutions.length ? solutions : ['잠시 후 같은 사진으로 다시 시도해 주세요.'],
    code: data?.code || 'UNKNOWN_ERROR',
    status,
    detail: data?.detail || data?.preview || ''
  };
}

function AnalysisErrorCard({ error }) {
  if (!error) return null;
  const info = typeof error === 'string'
    ? { title: '분석 실패', reason: error, solutions: ['잠시 후 다시 시도해 주세요.'], code: 'UNKNOWN_ERROR', status: '' }
    : error;

  return (
    <div className="analysisError" role="alert">
      <div className="analysisErrorTitle"><span aria-hidden="true">!</span>{info.title}</div>
      <div className="analysisErrorSection">
        <strong>원인</strong>
        <p>{info.reason}</p>
      </div>
      <div className="analysisErrorSection">
        <strong>해결 방법</strong>
        <ul>{(info.solutions || []).map((solution, index) => <li key={index}>{solution}</li>)}</ul>
      </div>
      <div className="analysisErrorMeta">
        <span>오류 코드: {info.code || 'UNKNOWN_ERROR'}</span>
        {info.status ? <span>HTTP 상태: {info.status}</span> : null}
      </div>
      {info.detail ? <details><summary>기술 정보 보기</summary><pre>{info.detail}</pre></details> : null}
    </div>
  );
}



function CropModal({ item, onClose, onApply }) {
  const cropperRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function getCropper() {
    return cropperRef.current?.cropper || null;
  }

  async function handleApply() {
    const cropper = getCropper();
    if (!cropper || saving) return;

    setSaving(true);
    setError('');
    try {
      const canvas = cropper.getCroppedCanvas({
        maxWidth: 2400,
        maxHeight: 2400,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });
      if (!canvas) throw new Error('선택한 영역을 읽지 못했습니다.');

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('자른 이미지를 만들지 못했습니다.');

      const baseName = String(item.name || 'photo').replace(/\.[^.]+$/, '');
      const file = new File([blob], `${baseName}-cropped.jpg`, { type: 'image/jpeg' });
      await onApply(file);
    } catch (err) {
      setError(err?.message || '사진 자르기에 실패했습니다.');
      setSaving(false);
    }
  }

  function resetCrop() {
    const cropper = getCropper();
    if (!cropper) return;
    cropper.reset();
    cropper.setAspectRatio(NaN);
    setError('');
  }

  return (
    <div className="cropModalBackdrop" role="dialog" aria-modal="true" aria-label="사진 자르기">
      <div className="cropModal">
        <div className="cropModalHeader">
          <div>
            <strong>사진 자르기</strong>
            <p>테두리의 모서리나 선을 움직여 분석할 부분을 선택하세요.</p>
          </div>
          <button type="button" className="cropClose" onClick={onClose} disabled={saving} aria-label="닫기">×</button>
        </div>

        <div className="cropStage borderCropStage">
          <Cropper
            ref={cropperRef}
            src={item.preview}
            style={{ height: '100%', width: '100%' }}
            viewMode={1}
            dragMode="move"
            initialAspectRatio={NaN}
            aspectRatio={NaN}
            autoCropArea={0.88}
            background={false}
            responsive
            restore={false}
            guides
            center
            highlight
            movable
            zoomable
            scalable={false}
            rotatable
            cropBoxMovable
            cropBoxResizable
            toggleDragModeOnDblclick={false}
            checkOrientation={false}
          />
        </div>

        <div className="cropControls borderCropControls">
          <div className="cropQuickControls">
            <button type="button" onClick={() => getCropper()?.zoom(0.1)}>확대 +</button>
            <button type="button" onClick={() => getCropper()?.zoom(-0.1)}>축소 −</button>
            <button type="button" onClick={() => getCropper()?.rotate(-90)}>왼쪽 회전</button>
            <button type="button" onClick={() => getCropper()?.rotate(90)}>오른쪽 회전</button>
            <button type="button" onClick={() => getCropper()?.setAspectRatio(1)}>1:1</button>
            <button type="button" onClick={() => getCropper()?.setAspectRatio(NaN)}>자유 비율</button>
            <button type="button" onClick={resetCrop}>초기화</button>
          </div>
          <p className="cropHelp">흰색 테두리의 모서리 또는 선을 드래그해 영역을 조절할 수 있습니다.</p>
          {error ? <div className="cropError">{error}</div> : null}
        </div>

        <div className="cropModalActions">
          <button type="button" className="cropCancel" onClick={onClose} disabled={saving}>취소</button>
          <button type="button" className="cropApply" onClick={handleApply} disabled={saving}>{saving ? '저장 중...' : '자르기 완료'}</button>
        </div>
      </div>
    </div>
  );
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



function apiHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function apiRequest(path, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(`/.netlify/functions/${path}`, {
    method,
    headers: apiHeaders(token),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || data?.reason || `요청 실패 (${response.status})`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function LoginScreen({ onLogin }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest('account-login', {
        method: 'POST',
        body: { loginId: loginId.trim(), password }
      });
      localStorage.setItem('math_checker_token', data.token);
      onLogin(data);
    } catch (err) {
      setError(err?.message || '로그인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authPage">
      <section className="authCard">
        <div className="authBrandMark">✓</div>
        <span className="authEyebrow">AI MATH CHECKER</span>
        <h1>풀이체커 로그인</h1>
        <p>관리자에게 발급받은 아이디와 비밀번호를 입력하세요.</p>
        <form className="authForm" onSubmit={submit}>
          <label>
            <span>아이디</span>
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" placeholder="발급받은 아이디" required />
          </label>
          <label>
            <span>비밀번호</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="비밀번호" required />
          </label>
          {error ? <div className="authAlert error" role="alert">{error}</div> : null}
          <button className="authSubmit" type="submit" disabled={busy}>{busy ? '로그인 중...' : '로그인'}</button>
        </form>
        <p className="authNote">회원가입 없이 관리자가 발급한 계정만 사용할 수 있습니다.</p>
      </section>
    </main>
  );
}

function QuotaPanel({ account }) {
  const limit = Number(account?.limit_count || 0);
  const used = Number(account?.used_count || 0);
  const remaining = Math.max(0, limit - used);
  return (
    <section className="quotaPanel">
      <div><span>총 분석 가능</span><b>{limit.toLocaleString()}장</b></div>
      <div><span>사용한 분석</span><b>{used.toLocaleString()}장</b></div>
      <div><span>남은 분석</span><b>{remaining.toLocaleString()}장</b></div>
    </section>
  );
}

function CheckerApp({ auth, onLogout, onAccountUpdate }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cropTargetId, setCropTargetId] = useState(null);
  const inputRef = useRef(null);
  const account = auth.account;
  const token = auth.token;
  const remaining = Math.max(0, Number(account?.limit_count || 0) - Number(account?.used_count || 0));
  const canAnalyze = useMemo(() => items.length > 0 && !busy && remaining >= items.length, [items, busy, remaining]);

  function addFiles(fileList) {
    const imageFiles = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    const slots = Math.max(0, MAX_FILES - items.length);
    const selected = imageFiles.slice(0, slots);
    if (!selected.length) return;
    const next = selected.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`, file, name: file.name, size: file.size,
      preview: URL.createObjectURL(file), status: 'ready', result: null, error: null
    }));
    setItems((prev) => [...prev, ...next]);
  }

  function openCrop(id) { if (!busy) setCropTargetId(id); }
  function closeCrop() { setCropTargetId(null); }
  async function applyCrop(file) {
    setItems((prev) => prev.map((item) => {
      if (item.id !== cropTargetId) return item;
      if (item.preview) URL.revokeObjectURL(item.preview);
      return { ...item, file, name: file.name, size: file.size, preview: URL.createObjectURL(file), status: 'ready', result: null, error: null, cropped: true };
    }));
    setCropTargetId(null);
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
    setCropTargetId(null);
  }

  async function analyzeOne(item) {
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'compressing', error: null, result: null } : x));
    const imageDataUrl = await compressImageToDataUrl(item.file);
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'analyzing' } : x));
    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: apiHeaders(token),
      body: JSON.stringify({ imageDataUrl, fileName: item.name })
    });
    const data = await response.json().catch(() => ({}));
    if (data?.account) onAccountUpdate(data.account);
    if (!response.ok) throw normalizeErrorPayload(data, response.status);
    return data;
  }

  async function analyzeAll() {
    if (!items.length || busy) return;
    if (remaining < items.length) {
      alert(`남은 분석 가능 횟수는 ${remaining}장입니다. 사진 수를 줄여 주세요.`);
      return;
    }
    setBusy(true);
    for (const item of items) {
      try {
        const result = await analyzeOne(item);
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'done', result, error: null } : x));
      } catch (error) {
        setItems((prev) => prev.map((x) => x.id === item.id ? {
          ...x, status: 'error',
          error: error?.title ? error : { title: '분석 실패', reason: error?.message || '알 수 없는 오류가 발생했습니다.', solutions: ['잠시 후 다시 시도해 주세요.'], code: 'CLIENT_ERROR', status: '' }
        } : x));
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
      return message && message !== verdict ? `${number}번: ${verdict} - ${message}` : `${number}번: ${verdict}`;
    });
    navigator.clipboard.writeText(lines.join('\n'));
  }

  const cleanCount = items.filter((x) => resultIsClean(x.result)).length;
  const reviewCount = items.filter((x) => x.result && !resultIsClean(x.result)).length;

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brand"><div className="brandMark">✓</div><div><strong>풀이체커</strong><span>AI Math Checker</span></div></div>
        <div className="topbarActions">
          <span className="userEmail">{account?.login_id}</span>
          <button type="button" className="logoutButton" onClick={onLogout}>로그아웃</button>
          <a className="kakaoButton" href={KAKAO_LINK} target="_blank" rel="noreferrer noopener"><span className="kakaoDot" />문의하기<span>↗</span></a>
        </div>
      </header>
      <div className="appContent">
        <QuotaPanel account={account} />
        <section className="heroCard">
          <div className="heroCopy"><span className="betaPill">교사용</span><h1>학생 풀이,<br /><em>틀린 곳만 빠르게</em></h1><p>사진을 올리면 맞음·틀림을 문제별로 판정하고, 틀린 경우 최초 오류만 간단히 알려드립니다.</p><div className="featurePills"><span>최대 6장</span><span>문제별 판정</span><span>계정별 한도</span></div></div>
          <div className="heroPreview" aria-hidden="true"><div className="previewSheet"><span className="previewLine long" /><span className="previewLine" /><span className="previewLine medium" /><div className="previewResult ok">✓ 맞음</div><div className="previewResult bad">! 부호 오류</div></div></div>
        </section>
        <section className="workspaceCard">
          <div className="sectionHeading"><div><span className="stepLabel">STEP 1</span><h2>풀이 사진 올리기</h2><p>한 번에 최대 6장까지 분석할 수 있어요.</p></div><span className="fileCounter">{items.length}/{MAX_FILES}</span></div>
          <div className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <div className="uploadIcon"><svg viewBox="0 0 24 24"><path d="M7 7.5h1.2l1-1.7h5.6l1 1.7H17a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6.5a3 3 0 0 1 3-3Z" /><circle cx="12" cy="13" r="3.2" /></svg></div>
            <h3>사진 선택 또는 촬영</h3><p>문제와 학생 풀이가 함께 보이도록 선명하게 찍어주세요.</p><button type="button" className="selectButton">사진 불러오기</button>
          </div>
          <div className="uploadGuide"><span>✓ 세로·가로 사진 모두 가능</span><span>✓ JPG·PNG 지원</span><span>✓ 업로드 전 자동 압축</span></div>
        </section>
        <div className="actions"><button className="primary" disabled={!canAnalyze} onClick={analyzeAll}><span>{busy ? '분석 중...' : '전체 분석'}</span><span>→</span></button><button className="ghost" disabled={busy || !items.length} onClick={clearAll}>전체 삭제</button></div>
        <p className="quotaPolicy">※ 분석이 시작되면 결과와 관계없이 분석 횟수가 차감됩니다.</p>
        {remaining < items.length && items.length > 0 ? <div className="quotaWarning">남은 분석 가능 횟수는 {remaining}장입니다. 사진 수를 줄여 주세요.</div> : null}
        {items.some((x) => x.result) && <section className="summary"><div><b>{items.length}</b><span>전체</span></div><div><b>{cleanCount}</b><span>맞음</span></div><div><b>{reviewCount}</b><span>확인 필요</span></div></section>}
        <section className="grid">
          {items.map((item, idx) => <article className="card" key={item.id}>
            <div className="thumbWrap"><img src={item.preview} alt={item.name} /><span className={`status ${item.status}`}>{statusLabel(item.status)}</span></div>
            <div className="cardBody">
              <div className="row between"><div><span className="cardIndex">PHOTO {String(idx + 1).padStart(2, '0')}</span><strong>학생 풀이 {idx + 1}</strong></div><div className="cardTools"><button className="cropLinkBtn" disabled={busy} onClick={() => openCrop(item.id)}>자르기</button><button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button></div></div>
              <p className="meta">{item.name} · {formatBytes(item.size)}{item.cropped ? ' · 자르기 적용됨' : ''}</p>
              {item.status === 'ready' && <p className="muted">분석할 준비가 됐어요.</p>}
              {item.status === 'compressing' && <p className="muted loadingText">이미지 전송 준비 중...</p>}
              {item.status === 'analyzing' && <p className="muted loadingText">AI가 풀이를 검산하고 있어요...</p>}
              {item.status === 'error' && <AnalysisErrorCard error={item.error} />}
              {item.result && <ResultCard item={item} onCopy={() => copyResult(item)} />}
            </div>
          </article>)}
        </section>
        {!items.length && <section className="emptyState"><div className="emptyIcon">⌁</div><strong>아직 올린 사진이 없어요</strong><p>위의 사진 업로드 버튼을 눌러 풀이 사진을 추가하세요.</p></section>}
        {cropTargetId ? <CropModal item={items.find((item) => item.id === cropTargetId)} onClose={closeCrop} onApply={applyCrop} /> : null}
        <footer className="footerNote"><p>AI 분석 결과는 보조 자료입니다. 중요한 판정은 직접 한 번 더 확인해 주세요.</p><a href={KAKAO_LINK} target="_blank" rel="noreferrer noopener">오류 제보 및 문의</a></footer>
      </div>
    </main>
  );
}

function AdminLogin({ onLogin }) {
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const data = await apiRequest('admin-login', { method: 'POST', body: { adminId, password } });
      localStorage.setItem('math_checker_admin_token', data.token);
      onLogin(data.token);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <main className="authPage"><section className="authCard"><div className="authBrandMark">A</div><span className="authEyebrow">ADMIN</span><h1>관리자 로그인</h1><p>계정과 분석 한도를 관리합니다.</p><form className="authForm" onSubmit={submit}><label><span>관리자 아이디</span><input value={adminId} onChange={(e)=>setAdminId(e.target.value)} required /></label><label><span>비밀번호</span><input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required /></label>{error?<div className="authAlert error">{error}</div>:null}<button className="authSubmit" disabled={busy}>{busy?'로그인 중...':'관리자 로그인'}</button></form></section></main>;
}

function AdminApp({ token, onLogout }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ loginId:'', password:'', limitCount:100 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try { const data = await apiRequest('admin-api', { token }); setAccounts(data.accounts || []); }
    catch (e) { setError(e.message); if (e.status===401) onLogout(); }
  }
  React.useEffect(()=>{ load(); }, []);

  async function action(actionName, payload={}) {
    setError(''); setMessage('');
    try {
      const data = await apiRequest('admin-api', { method:'POST', token, body:{ action:actionName, ...payload } });
      setMessage(data.message || '처리되었습니다.');
      if (data.accounts) setAccounts(data.accounts); else await load();
    } catch(e){ setError(e.message); }
  }

  return <main className="adminPage">
    <header className="adminTop"><div><strong>풀이체커 관리자</strong><span>계정·분석 장수 관리</span></div><div><a href="/">사용자 화면</a><button onClick={onLogout}>로그아웃</button></div></header>
    <div className="adminContent">
      <section className="adminCreate"><h2>새 계정 만들기</h2><div className="adminFormRow"><input placeholder="아이디" value={form.loginId} onChange={(e)=>setForm({...form,loginId:e.target.value})}/><input placeholder="비밀번호" type="password" value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})}/><input type="number" min="0" value={form.limitCount} onChange={(e)=>setForm({...form,limitCount:e.target.value})}/><button onClick={()=>action('create',{...form,limitCount:Number(form.limitCount)})}>계정 생성</button></div></section>
      {error?<div className="authAlert error">{error}</div>:null}{message?<div className="authAlert success">{message}</div>:null}
      <section className="adminTableWrap"><table className="adminTable"><thead><tr><th>아이디</th><th>총 한도</th><th>사용</th><th>남음</th><th>상태</th><th>관리</th></tr></thead><tbody>
        {accounts.map(a=><tr key={a.id}><td><b>{a.login_id}</b></td><td>{a.limit_count}</td><td>{a.used_count}</td><td>{Math.max(0,a.limit_count-a.used_count)}</td><td>{a.active?'사용중':'중지'}</td><td><div className="adminButtons">
          <button onClick={()=>action('add_limit',{accountId:a.id,amount:10})}>+10</button><button onClick={()=>action('add_limit',{accountId:a.id,amount:50})}>+50</button><button onClick={()=>action('add_limit',{accountId:a.id,amount:100})}>+100</button>
          <button onClick={()=>{const amount=Number(prompt('추가할 장수를 입력하세요.','500')); if(amount>0) action('add_limit',{accountId:a.id,amount});}}>직접 추가</button>
          <button onClick={()=>{const n=Number(prompt('총 분석 가능 장수를 입력하세요.',String(a.limit_count))); if(n>=0) action('set_limit',{accountId:a.id,limitCount:n});}}>한도 변경</button>
          <button onClick={()=>action('reset_used',{accountId:a.id})}>사용량 초기화</button>
          <button onClick={()=>{const p=prompt('새 비밀번호를 입력하세요.'); if(p) action('change_password',{accountId:a.id,password:p});}}>비밀번호 변경</button>
          <button onClick={()=>action('toggle_active',{accountId:a.id,active:!a.active})}>{a.active?'사용중지':'사용재개'}</button>
          <button className="danger" onClick={()=>{if(confirm(`${a.login_id} 계정을 삭제할까요?`)) action('delete',{accountId:a.id});}}>삭제</button>
        </div></td></tr>)}
      </tbody></table></section>
    </div>
  </main>;
}

function RootApp() {
  const isAdmin = window.location.pathname.startsWith('/admin');
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState(null);
  const [adminToken, setAdminToken] = useState(localStorage.getItem('math_checker_admin_token') || '');

  React.useEffect(() => {
    if (isAdmin) { setLoading(false); return; }
    const token = localStorage.getItem('math_checker_token');
    if (!token) { setLoading(false); return; }
    apiRequest('account-me', { token }).then((data)=>setAuth({ token, account:data.account })).catch(()=>localStorage.removeItem('math_checker_token')).finally(()=>setLoading(false));
  }, []);

  async function logout() {
    const token = auth?.token;
    localStorage.removeItem('math_checker_token');
    setAuth(null);
    if (token) apiRequest('account-logout',{method:'POST',token}).catch(()=>{});
  }

  if (isAdmin) {
    return adminToken ? <AdminApp token={adminToken} onLogout={()=>{localStorage.removeItem('math_checker_admin_token');setAdminToken('');}} /> : <AdminLogin onLogin={setAdminToken} />;
  }
  if (loading) return <main className="authPage"><div className="authLoading">로그인 상태를 확인하고 있어요...</div></main>;
  return auth
    ? <CheckerApp auth={auth} onLogout={logout} onAccountUpdate={(account)=>setAuth((prev)=>({...prev,account}))} />
    : <LoginScreen onLogin={(data)=>setAuth({token:data.token,account:data.account})} />;
}

createRoot(document.getElementById('root')).render(<RootApp />);
