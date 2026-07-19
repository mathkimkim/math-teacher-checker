import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cropper } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import './styles.css';

const MAX_FILES = 6;
const MAX_IMAGE_SIDE = 1800;
const JPEG_QUALITY = 0.84;
const KAKAO_LINK = 'https://open.kakao.com/o/sIycgvDi';

let mathJaxPromise = null;

const LATEX_COMMANDS = [
  'operatorname', 'therefore', 'triangle', 'begin', 'binom', 'beta', 'theta',
  'times', 'text', 'frac', 'sqrt', 'right', 'left', 'nabla', 'neq', 'not',
  'forall', 'alpha', 'gamma', 'delta', 'lambda', 'sigma', 'omega', 'cdot',
  'div', 'pm', 'le', 'ge', 'ne', 'to', 'tan', 'sin', 'cos', 'log', 'ln'
];

function repairBrokenLatex(value) {
  let text = String(value || '');
  if (!text) return '';

  // JSON에서 \times, \frac, \right 등이 \t, \f, \r 같은 제어문자로
  // 잘못 해석된 경우 원래 LaTeX 명령으로 되돌린다.
  text = text
    .replace(/\u0009herefore/g, String.raw`\therefore`)
    .replace(/\u0009riangle/g, String.raw`\triangle`)
    .replace(/\u0009imes/g, String.raw`\times`)
    .replace(/\u0009heta/g, String.raw`\theta`)
    .replace(/\u0009ext/g, String.raw`\text`)
    .replace(/\u0009an/g, String.raw`\tan`)
    .replace(/\u0009o/g, String.raw`\to`)
    .replace(/\u000Corall/g, String.raw`\forall`)
    .replace(/\u000Crac/g, String.raw`\frac`)
    .replace(/\u000Dight/g, String.raw`\right`)
    .replace(/\u000Dho/g, String.raw`\rho`)
    .replace(/\u0008egin/g, String.raw`\begin`)
    .replace(/\u0008inom/g, String.raw`\binom`)
    .replace(/\u0008eta/g, String.raw`\beta`)
    .replace(/\u000Aabla/g, String.raw`\nabla`)
    .replace(/\u000Aeq/g, String.raw`\neq`)
    .replace(/\u000Aot/g, String.raw`\not`)
    .replace(/\u000Au/g, String.raw`\nu`)
    .replace(/\u000Ae(?=[^A-Za-z]|$)/g, String.raw`\ne`);

  // 제어문자가 이미 사라져 '2imes5', 'rac{1}{2}'처럼 남은 경우도 복원한다.
  text = text
    .replace(/(?<!\\)([0-9A-Za-z}\)])imes(?=[0-9A-Za-z{(])/g, (_, left) => `${left}${String.raw`\times `}`)
    .replace(/(^|[^A-Za-z\\])rac(?=\s*\{)/g, (_, prefix) => `${prefix}${String.raw`\frac`}`)
    .replace(/(^|[^A-Za-z\\])ext(?=\s*\{)/g, (_, prefix) => `${prefix}${String.raw`\text`}`)
    .replace(/(^|[^A-Za-z\\])heta(?=[^A-Za-z]|$)/g, (_, prefix) => `${prefix}${String.raw`\theta`}`)
    .replace(/(^|[^A-Za-z\\])herefore(?=[^A-Za-z]|$)/g, (_, prefix) => `${prefix}${String.raw`\therefore`}`);

  // 과도하게 이중 이스케이프된 알려진 명령은 한 개의 백슬래시로 통일한다.
  const commandPattern = LATEX_COMMANDS.join('|');
  const doubledCommand = new RegExp(String.raw`\\\\(?=(?:${commandPattern})(?:\\b|\\s*\\{))`, 'g');
  while (doubledCommand.test(text)) {
    doubledCommand.lastIndex = 0;
    text = text.replace(doubledCommand, '\\');
  }

  return text
    .replace(/−/g, '-')
    .replace(/×/g, String.raw`\times `)
    .replace(/÷/g, String.raw`\div `)
    .replace(/≤/g, String.raw`\le `)
    .replace(/≥/g, String.raw`\ge `)
    .replace(/≠/g, String.raw`\ne `)
    .replace(/±/g, String.raw`\pm `)
    .replace(/²/g, '^2')
    .replace(/³/g, '^3');
}

function balanceLatex(value) {
  let text = repairBrokenLatex(value);
  if (!text) return '';

  let depth = 0;
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const escaped = index > 0 && text[index - 1] === '\\';
    if (!escaped && char === '{') depth += 1;
    if (!escaped && char === '}') {
      if (depth === 0) continue;
      depth -= 1;
    }
    output += char;
  }
  if (depth > 0) output += '}'.repeat(depth);

  const leftCount = (output.match(/\\left\b/g) || []).length;
  const rightCount = (output.match(/\\right\b/g) || []).length;
  if (leftCount > rightCount) output += String.raw`\right.`.repeat(leftCount - rightCount);
  if (rightCount > leftCount) output = String.raw`\left.`.repeat(rightCount - leftCount) + output;

  return output.trim();
}

function wrapUndelimitedMath(value) {
  const wrapPlainMath = (part) => {
    let text = part;

    // Gemini가 설명 안에 구분자 없이 넣은 LaTeX 명령을 인라인 수식으로 감싼다.
    text = text.replace(
      /\\(?:overline|underline|vec|sqrt)\s*(?:\[[^\]\n]*\])?\s*\{[^{}\n]+\}(?:\s*\^\s*(?:\{[^{}\n]+\}|[-+]?\d+))?/g,
      (math) => '\\(' + balanceLatex(math) + '\\)'
    );
    text = text.replace(
      /\\frac\s*\{[^{}\n]+\}\s*\{[^{}\n]+\}/g,
      (math) => '\\(' + balanceLatex(math) + '\\)'
    );

    // (-2-a)^2, 4+4a+a^2처럼 일반 문자로 섞여 온 식도 수식으로 표시한다.
    text = text.replace(/[A-Za-z0-9(][A-Za-z0-9(){}+\-*/=^. ]{1,80}/g, (candidate) => {
      const trailingSpace = candidate.match(/\s+$/)?.[0] || '';
      const math = candidate.trim();
      if (!math || !/[+\-*/=^]/.test(math) || !/[A-Za-z0-9]/.test(math)) return candidate;
      return '\\(' + balanceLatex(math) + '\\)' + trailingSpace;
    });

    return text;
  };

  // 이미 정상적인 수식 구분자가 있는 구간은 다시 감싸지 않는다.
  return String(value || '')
    .split(/(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g)
    .map((part) => (/^\\[[(]/.test(part) ? part : wrapPlainMath(part)))
    .join('');
}

function normalizeMathText(value) {
  let text = repairBrokenLatex(value).trim();
  if (!text) return '';

  text = text
    .split(String.raw`\\(`).join(String.raw`\(`)
    .split(String.raw`\\)`).join(String.raw`\)`)
    .split(String.raw`\\[`).join(String.raw`\[`)
    .split(String.raw`\\]`).join(String.raw`\]`);

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => String.raw`\[${balanceLatex(math.trim())}\]`);
  text = text.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_, prefix, math) => `${prefix}${String.raw`\(${balanceLatex(math.trim())}\)`}`);

  // 이미 들어 있는 MathJax 구분자 안쪽도 한 번 더 보정한다.
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => String.raw`\(${balanceLatex(math)}\)`);
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => String.raw`\[${balanceLatex(math)}\]`);

  return wrapUndelimitedMath(text);
}

function toDisplayMath(value) {
  let expression = repairBrokenLatex(value).trim();
  if (!expression) return '';

  expression = expression
    .replace(/^\s*\\\((.*)\\\)\s*$/s, '$1')
    .replace(/^\s*\\\[(.*)\\\]\s*$/s, '$1')
    .replace(/^\s*\$\$(.*)\$\$\s*$/s, '$1')
    .replace(/^\s*\$(.*)\$\s*$/s, '$1')
    .trim();

  return String.raw`\[${balanceLatex(expression)}\]`;
}

function latexToReadableText(value) {
  let text = repairBrokenLatex(value)
    .replace(/\\\[|\\\]|\\\(|\\\)|\$\$/g, '')
    .replace(/\$/g, '')
    .trim();

  // 단순한 분수와 근호는 브라우저 기본 문자로도 읽기 쉽게 바꾼다.
  for (let count = 0; count < 4; count += 1) {
    text = text.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)');
    text = text.replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)');
  }

  return text
    .replace(/\\times\b/g, '×')
    .replace(/\\div\b/g, '÷')
    .replace(/\\cdot\b/g, '·')
    .replace(/\\le\b/g, '≤')
    .replace(/\\ge\b/g, '≥')
    .replace(/\\(?:ne|neq)\b/g, '≠')
    .replace(/\\pm\b/g, '±')
    .replace(/\\therefore\b/g, '∴')
    .replace(/\\theta\b/g, 'θ')
    .replace(/\\alpha\b/g, 'α')
    .replace(/\\beta\b/g, 'β')
    .replace(/\\left|\\right/g, '')
    .replace(/\\text\s*\{([^{}]*)\}/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureMathJax() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.MathJax?.typesetPromise) return Promise.resolve();
  if (mathJaxPromise) return mathJaxPromise;

  window.MathJax = {
    tex: {
      inlineMath: [['\\(', '\\)']],
      displayMath: [['\\[', '\\]']],
      processEscapes: true,
      packages: { '[+]': ['ams'] }
    },
    loader: { load: ['[tex]/ams'] },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
    },
    chtml: { scale: 1 }
  };

  mathJaxPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('mathjax-script');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('수학식 표시 기능을 불러오지 못했습니다.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'mathjax-script';
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('수학식 표시 기능을 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });

  return mathJaxPromise;
}

function MathText({ text, className = '' }) {
  const ref = useRef(null);
  const normalizedText = normalizeMathText(text);

  useEffect(() => {
    let cancelled = false;
    const node = ref.current;
    if (!node) return undefined;

    const showFallback = () => {
      if (cancelled || !node) return;
      window.MathJax?.typesetClear?.([node]);
      node.textContent = latexToReadableText(normalizedText);
      node.classList.add('mathFallback');
    };

    node.textContent = normalizedText;
    node.classList.remove('mathFallback');

    ensureMathJax()
      .then(() => {
        if (cancelled || !node || !window.MathJax?.typesetPromise) return;
        window.MathJax.typesetClear?.([node]);
        return window.MathJax.typesetPromise([node]);
      })
      .then(() => {
        if (cancelled || !node) return;
        const hasMathError = Boolean(node.querySelector('mjx-merror, .mjx-merror'))
          || /Math input error/i.test(node.textContent || '');
        if (hasMathError) showFallback();
      })
      .catch(showFallback);

    return () => {
      cancelled = true;
      window.MathJax?.typesetClear?.([node]);
    };
  }, [normalizedText]);

  return <div ref={ref} className={`mathMessage ${className}`.trim()}>{normalizedText}</div>;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatCompactCount(value) {
  const number = Math.max(0, Number(value) || 0);
  const units = [
    { size: 1_000_000_000, suffix: 'B' },
    { size: 1_000_000, suffix: 'M' },
    { size: 1_000, suffix: 'k' }
  ];

  for (const unit of units) {
    if (number >= unit.size) {
      const scaled = number / unit.size;
      const digits = scaled >= 100 || Number.isInteger(scaled) ? 0 : 1;
      return `${scaled.toFixed(digits).replace(/\.0$/, '')}${unit.suffix}`;
    }
  }

  return number.toLocaleString();
}

const DEFAULT_API_PRICING = Object.freeze({
  model: 'gemini-3.5-flash',
  inputPerMillion: 1.5,
  outputPerMillion: 9
});

function calculateUsageCost(inputTokens, outputTokens, pricing = DEFAULT_API_PRICING) {
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  const inputRate = Math.max(0, Number(pricing?.inputPerMillion) || DEFAULT_API_PRICING.inputPerMillion);
  const outputRate = Math.max(0, Number(pricing?.outputPerMillion) || DEFAULT_API_PRICING.outputPerMillion);
  return (input / 1_000_000) * inputRate + (output / 1_000_000) * outputRate;
}

function formatUsd(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 100) return `$${amount.toFixed(2)}`;
  if (amount >= 1) return `$${amount.toFixed(3)}`;
  if (amount >= 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(6)}`;
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

function ResultCard({ item, onCopy, onConfirmCorrect, busy }) {
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
        const expression = String(problem?.expression || '').trim();
        const showMessage = message && message !== verdict && !(verdict === '맞음' && message === '맞음');
        const showExpression = verdict === '틀림' && expression;

        return (
          <div className="resultBlock" key={`${number}-${index}`}>
            <div className="resultHeading">
              <span className="problemNumber">{number}번</span>
              <div className={`verdict ${getVerdictClass(verdict)}`}>{verdict}</div>
            </div>
            {showExpression && (
              <MathText text={toDisplayMath(expression)} className="mathExpression" />
            )}
            {showMessage && <MathText text={message} className="mathExplanation" />}
            {verdict === '틀림' && (
              <button
                type="button"
                className="confirmCorrectButton"
                disabled={busy || item.recheckingProblem === number}
                onClick={() => onConfirmCorrect(item, problem, index)}
              >
                {item.recheckingProblem === number ? '뒷부분 재검토 중...' : '이 단계는 맞음 · 뒷부분 재검토'}
              </button>
            )}
            {problem?.teacherConfirmed ? (
              <p className="teacherConfirmedNote">선생님이 이전 판정을 맞음으로 수정해 이후 풀이를 다시 검토했습니다.</p>
            ) : null}
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

function TopbarQuota({ account }) {
  const limit = Number(account?.limit_count || 0);
  const used = Number(account?.used_count || 0);

  return (
    <div
      className="topbarQuota"
      aria-label={`사용 ${used.toLocaleString()}장, 한도 ${limit.toLocaleString()}장`}
      title={`사용 ${used.toLocaleString()}장 / 한도 ${limit.toLocaleString()}장`}
    >
      <span className="topbarQuotaItem used"><em>사용</em><strong>{used.toLocaleString()}</strong></span>
      <span className="topbarQuotaSlash" aria-hidden="true">/</span>
      <span className="topbarQuotaItem limit"><em>한도</em><strong>{limit.toLocaleString()}</strong></span>
    </div>
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

  const canAnalyze = useMemo(
    () => items.length > 0 && !busy && remaining >= items.length,
    [items, busy, remaining]
  );

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
      error: null
    }));
    setItems((prev) => [...prev, ...next]);
  }



  function openCrop(id) {
    if (busy) return;
    setCropTargetId(id);
  }

  function closeCrop() {
    setCropTargetId(null);
  }

  async function applyCrop(file) {
    setItems((prev) => prev.map((item) => {
      if (item.id !== cropTargetId) return item;
      if (item.preview) URL.revokeObjectURL(item.preview);
      return {
        ...item,
        file,
        name: file.name,
        size: file.size,
        preview: URL.createObjectURL(file),
        status: 'ready',
        result: null,
        error: null,
        cropped: true
      };
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

    const res = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: apiHeaders(token),
      body: JSON.stringify({ imageDataUrl, fileName: item.name })
    });

    const data = await res.json().catch(() => ({}));
    if (data?.account) onAccountUpdate(data.account);
    if (!res.ok) {
      throw normalizeErrorPayload(data, res.status);
    }
    return data;
  }

  async function confirmCorrectAndRecheck(item, problem, problemIndex) {
    if (busy || item.recheckingProblem) return;

    const problemNumber = String(problem?.number || problemIndex + 1).trim();
    setBusy(true);
    setItems((prev) => prev.map((x) => x.id === item.id
      ? { ...x, recheckingProblem: problemNumber, error: null }
      : x));

    try {
      const imageDataUrl = await compressImageToDataUrl(item.file);
      const res = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: apiHeaders(token),
        body: JSON.stringify({
          mode: 'recheck',
          imageDataUrl,
          fileName: item.name,
          problemNumber,
          confirmedExpression: problem?.expression || '',
          confirmedMessage: problem?.message || ''
        })
      });

      const data = await res.json().catch(() => ({}));
      if (data?.account) onAccountUpdate(data.account);
      if (!res.ok) throw normalizeErrorPayload(data, res.status);

      const rechecked = Array.isArray(data?.problems) ? data.problems[0] : null;
      if (!rechecked) throw new Error('재검토 결과를 받지 못했습니다.');

      setItems((prev) => prev.map((x) => {
        if (x.id !== item.id) return x;
        const currentProblems = Array.isArray(x.result?.problems) ? [...x.result.problems] : [];
        currentProblems[problemIndex] = { ...rechecked, number: problemNumber, teacherConfirmed: true };
        return {
          ...x,
          status: 'done',
          recheckingProblem: null,
          result: { ...(x.result || {}), problems: currentProblems },
          error: null
        };
      }));
    } catch (error) {
      setItems((prev) => prev.map((x) => x.id === item.id
        ? {
            ...x,
            recheckingProblem: null,
            error: error?.title ? error : {
              title: '재검토 실패',
              reason: error?.message || '뒷부분을 다시 검토하지 못했습니다.',
              solutions: ['잠시 후 다시 눌러 주세요.'],
              code: 'RECHECK_ERROR',
              status: ''
            }
          }
        : x));
    } finally {
      setBusy(false);
    }
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
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'error', error: error?.title ? error : { title: '분석 실패', reason: error?.message || '알 수 없는 오류가 발생했습니다.', solutions: ['잠시 후 다시 시도해 주세요.'], code: 'CLIENT_ERROR', status: '' } } : x));
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
      const expression = String(problem?.expression || '').trim();
      const details = [];
      if (expression) details.push(expression);
      if (message && message !== verdict) details.push(message);
      return details.length
        ? `${number}번: ${verdict}\n${details.join('\n')}`
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

        <div className="topbarActions">
          <span className="userEmail">{account?.login_id}</span>
          <TopbarQuota account={account} />
          <button type="button" className="logoutButton" onClick={onLogout}>로그아웃</button>
          <a className="kakaoButton inquiryButton" href={KAKAO_LINK} target="_blank" rel="noreferrer noopener" aria-label="문의하기">
            <span className="kakaoDot" aria-hidden="true" />
            문의하기
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <div className="appContent">
        <section className="quickStartGrid" aria-label="빠른 시작">
          <article className="heroMiniCard">
            <div className="heroMiniCopy">
              <h1>학생 풀이<br /><em>틀린 곳만 빠르게</em></h1>
              <div className="featurePills" aria-label="주요 기능">
                <span>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="m7.1 10 1.8 1.9 4-4.1" /></svg>
                  최대 6장
                </span>
                <span>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="m7.1 10 1.8 1.9 4-4.1" /></svg>
                  문제별 판정
                </span>
              </div>
            </div>

            <div className="heroMiniIllustration" aria-hidden="true">
              <svg viewBox="0 0 128 112" role="img">
                <g className="clipboardShadow" transform="rotate(8 73 56)">
                  <rect x="42" y="22" width="58" height="76" rx="9" />
                </g>
                <g className="clipboard" transform="rotate(8 73 56)">
                  <rect className="clipboardBody" x="38" y="17" width="58" height="76" rx="9" />
                  <rect className="clipboardPaper" x="45" y="28" width="44" height="57" rx="5" />
                  <rect className="clipboardClip" x="56" y="11" width="23" height="15" rx="5" />
                  <circle className="clipboardPin" cx="67.5" cy="15.5" r="2.5" />
                  <path className="clipboardCheck" d="m57 59 8 8 16-18" />
                </g>
                <g className="pencil" transform="rotate(-20 34 70)">
                  <rect className="pencilBody" x="27" y="39" width="13" height="53" rx="3" />
                  <rect className="pencilBand" x="27" y="45" width="13" height="8" />
                  <path className="pencilTip" d="M27 92h13l-6.5 12Z" />
                  <path className="pencilLead" d="m31.5 99 2 5 2-5Z" />
                </g>
              </svg>
            </div>
          </article>

          <article
            className={`uploadMiniCard ${dragging ? 'dragging' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          >
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <span className="miniFileCounter">{items.length} / {MAX_FILES}</span>
            <button type="button" className="miniSelectButton">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
                <circle cx="9" cy="9.5" r="1.4" />
                <path d="m5.5 17 4.2-4.4 3.1 3 2.2-2.2 3.5 3.6" />
              </svg>
              사진 불러오기
            </button>
            <p className="miniUploadHint">최대 6장까지 선택 가능</p>
          </article>
        </section>

        <div className="actions compactActions">
          <button className="primary" disabled={!canAnalyze} onClick={analyzeAll}>
            <svg className="actionIcon sparkleIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.8 13.4 8l4.8 1.5-4.8 1.5L12 16.2 10.6 11 5.8 9.5 10.6 8 12 2.8Z" />
              <path d="m18.5 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z" />
            </svg>
            <span>{busy ? '분석 중...' : '전체 분석'}</span>
            <span className="actionArrow" aria-hidden="true">›</span>
          </button>
          <button className="ghost" disabled={busy || !items.length} onClick={clearAll}>
            <svg className="actionIcon trashIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 7h15" />
              <path d="M9 7V4.8h6V7" />
              <path d="m7 7 .8 12h8.4L17 7" />
              <path d="M10 10.5v5.5M14 10.5v5.5" />
            </svg>
            <span>전체 삭제</span>
          </button>
        </div>

        {remaining < items.length && items.length > 0 ? (
          <div className="quotaWarning">남은 분석 가능 횟수는 {remaining}장입니다. 사진 수를 줄여 주세요.</div>
        ) : null}

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
                  <div className="cardTools">
                    <button className="cropLinkBtn" disabled={busy} onClick={() => openCrop(item.id)}>자르기</button>
                    <button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button>
                  </div>
                </div>
                <p className="meta">{item.name} · {formatBytes(item.size)}{item.cropped ? ' · 자르기 적용됨' : ''}</p>

                {item.status === 'ready' && <p className="muted">분석할 준비가 됐어요.</p>}
                {item.status === 'compressing' && <p className="muted loadingText">이미지 전송 준비 중...</p>}
                {item.status === 'analyzing' && <p className="muted loadingText">AI가 풀이를 검산하고 있어요...</p>}
                {item.status === 'error' && <AnalysisErrorCard error={item.error} />}

                {item.result && <ResultCard
                  item={item}
                  busy={busy}
                  onCopy={() => copyResult(item)}
                  onConfirmCorrect={confirmCorrectAndRecheck}
                />}
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


        {cropTargetId ? (
          <CropModal
            item={items.find((item) => item.id === cropTargetId)}
            onClose={closeCrop}
            onApply={applyCrop}
          />
        ) : null}

        <footer className="footerNote">
          <p>AI 분석 결과는 보조 자료입니다. 중요한 판정은 직접 한 번 더 확인해 주세요.</p>
          <a href={KAKAO_LINK} target="_blank" rel="noreferrer noopener">오류 제보 및 문의</a>
        </footer>
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
  const [pricing, setPricing] = useState(DEFAULT_API_PRICING);
  const [form, setForm] = useState({ loginId:'', password:'', limitCount:100 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await apiRequest('admin-api', { token });
      setAccounts(data.accounts || []);
      setPricing(data.pricing || DEFAULT_API_PRICING);
    }
    catch (e) { setError(e.message); if (e.status===401) onLogout(); }
  }
  React.useEffect(()=>{ load(); }, []);

  async function action(actionName, payload={}) {
    setError(''); setMessage('');
    try {
      const data = await apiRequest('admin-api', { method:'POST', token, body:{ action:actionName, ...payload } });
      setMessage(data.message || '처리되었습니다.');
      if (data.accounts) setAccounts(data.accounts); else await load();
      if (data.pricing) setPricing(data.pricing);
    } catch(e){ setError(e.message); }
  }

  const totalInputTokens = accounts.reduce((sum, account) => sum + Math.max(0, Number(account.total_input_tokens) || 0), 0);
  const totalOutputTokens = accounts.reduce((sum, account) => sum + Math.max(0, Number(account.total_output_tokens) || 0), 0);
  const totalEstimatedCost = calculateUsageCost(totalInputTokens, totalOutputTokens, pricing);

  return <main className="adminPage">
    <header className="adminTop"><div><strong>풀이체커 관리자</strong><span>계정·분석 장수 관리</span></div><div><a href="/">사용자 화면</a><button onClick={onLogout}>로그아웃</button></div></header>
    <div className="adminContent">
      <section className="adminUsageSummary" aria-label="전체 API 사용 현황">
        <div><span>전체 입력토큰</span><b>{formatCompactCount(totalInputTokens)}</b></div>
        <div><span>전체 출력토큰</span><b>{formatCompactCount(totalOutputTokens)}</b></div>
        <div><span>누적 예상비용</span><b>{formatUsd(totalEstimatedCost)} USD</b></div>
        <p>{pricing.model} · 입력 1M당 ${Number(pricing.inputPerMillion).toFixed(2)} / 출력 1M당 ${Number(pricing.outputPerMillion).toFixed(2)} 기준</p>
      </section>
      <section className="adminCreate"><h2>새 계정 만들기</h2><div className="adminFormRow"><input placeholder="아이디" value={form.loginId} onChange={(e)=>setForm({...form,loginId:e.target.value})}/><input placeholder="비밀번호" type="password" value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})}/><input type="number" min="0" value={form.limitCount} onChange={(e)=>setForm({...form,limitCount:e.target.value})}/><button onClick={()=>action('create',{...form,limitCount:Number(form.limitCount)})}>계정 생성</button></div></section>
      {error?<div className="authAlert error">{error}</div>:null}{message?<div className="authAlert success">{message}</div>:null}
      <section className="adminTableWrap"><table className="adminTable"><thead><tr><th>아이디</th><th>총 한도</th><th>사용</th><th>남음</th><th>입력토큰</th><th>출력토큰</th><th>누적토큰</th><th>누적비용(USD)</th><th>상태</th><th>관리</th></tr></thead><tbody>
        {accounts.map(a=>{
          const accountCost = calculateUsageCost(a.total_input_tokens, a.total_output_tokens, pricing);
          return <tr key={a.id}><td><b>{a.login_id}</b></td><td>{a.limit_count}</td><td>{a.used_count}</td><td>{Math.max(0,a.limit_count-a.used_count)}</td><td title={`${Number(a.total_input_tokens || 0).toLocaleString()} input tokens`}>{formatCompactCount(a.total_input_tokens)}</td><td title={`${Number(a.total_output_tokens || 0).toLocaleString()} output tokens`}>{formatCompactCount(a.total_output_tokens)}</td><td title={`${Number(a.total_tokens || 0).toLocaleString()} total tokens`}>{formatCompactCount(a.total_tokens)}</td><td title={`입력 $${((Number(a.total_input_tokens || 0) / 1_000_000) * Number(pricing.inputPerMillion)).toFixed(6)} + 출력 $${((Number(a.total_output_tokens || 0) / 1_000_000) * Number(pricing.outputPerMillion)).toFixed(6)}`}><b>{formatUsd(accountCost)}</b></td><td>{a.active?'사용중':'중지'}</td><td><div className="adminButtons">
          <button onClick={()=>action('add_limit',{accountId:a.id,amount:10})}>+10</button><button onClick={()=>action('add_limit',{accountId:a.id,amount:50})}>+50</button><button onClick={()=>action('add_limit',{accountId:a.id,amount:100})}>+100</button>
          <button onClick={()=>{const amount=Number(prompt('추가할 장수를 입력하세요.','500')); if(amount>0) action('add_limit',{accountId:a.id,amount});}}>직접 추가</button>
          <button onClick={()=>{const n=Number(prompt('총 분석 가능 장수를 입력하세요.',String(a.limit_count))); if(n>=0) action('set_limit',{accountId:a.id,limitCount:n});}}>한도 변경</button>
          <button onClick={()=>action('reset_used',{accountId:a.id})}>사용량 초기화</button>
          <button onClick={()=>{const p=prompt('새 비밀번호를 입력하세요.'); if(p) action('change_password',{accountId:a.id,password:p});}}>비밀번호 변경</button>
          <button onClick={()=>action('toggle_active',{accountId:a.id,active:!a.active})}>{a.active?'사용중지':'사용재개'}</button>
          <button className="danger" onClick={()=>{if(confirm(`${a.login_id} 계정을 삭제할까요?`)) action('delete',{accountId:a.id});}}>삭제</button>
        </div></td></tr>;
        })}
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
