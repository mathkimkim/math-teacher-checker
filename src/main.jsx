import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cropper } from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import './styles.css';

const MAX_FILES = 50;
const MAX_IMAGE_SIDE = 1800;
const JPEG_QUALITY = 0.84;
const KAKAO_LINK = 'https://open.kakao.com/o/sVJynZFi';

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

  text = text.replace(/(^|[^A-Za-z\\])(sqrt|frac)(?=\s*\{)/g,
    (_, prefix, command) => `${prefix}\\${command}`);

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
  model: 'gemini-3.6-flash',
  inputPerMillion: 1.5,
  outputPerMillion: 7.5
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

function formatAnalysisSeconds(value) {
  return `${Math.max(0, Number(value) || 0).toFixed(1)}초`;
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

function analysisStageText(stage) {
  switch (stage) {
    case 'CONNECTED': return '분석 서버에 연결했어요...';
    case 'AI_ANALYZING': return 'AI가 풀이를 분석하고 있어요...';
    case 'AI_RESPONSE_STREAMING': return 'AI 분석 결과를 받고 있어요...';
    case 'RESULT_ORGANIZING': return '분석 결과를 정리하고 있어요...';
    default: return 'AI가 풀이를 확인하고 있어요...';
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

function splitImage(file, direction = 'vertical', position = 50) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = async () => {
      try {
        const ratio = Math.min(0.8, Math.max(0.2, Number(position) / 100));
        const isVertical = direction === 'vertical';
        const firstSize = Math.max(1, Math.floor((isVertical ? img.width : img.height) * ratio));
        const secondSize = Math.max(1, (isVertical ? img.width : img.height) - firstSize);
        const baseName = String(file.name || 'photo').replace(/\.[^.]+$/, '');
        const makeHalf = (offset, cropSize, suffix) => new Promise((resolveHalf, rejectHalf) => {
          const canvas = document.createElement('canvas');
          canvas.width = isVertical ? cropSize : img.width;
          canvas.height = isVertical ? img.height : cropSize;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            rejectHalf(new Error('이미지 분할 화면을 만들지 못했습니다.'));
            return;
          }
          const sourceX = isVertical ? offset : 0;
          const sourceY = isVertical ? 0 : offset;
          const sourceWidth = isVertical ? cropSize : img.width;
          const sourceHeight = isVertical ? img.height : cropSize;
          ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) {
              rejectHalf(new Error('분할 이미지를 만들지 못했습니다.'));
              return;
            }
            resolveHalf(new File([blob], `${baseName}-${suffix}.jpg`, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.92);
        });
        const halves = await Promise.all([
          makeHalf(0, firstSize, isVertical ? '왼쪽' : '위쪽'),
          makeHalf(firstSize, secondSize, isVertical ? '오른쪽' : '아래쪽')
        ]);
        URL.revokeObjectURL(objectUrl);
        resolve(halves);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('나눌 사진을 읽지 못했습니다.'));
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
  const statusSolutions = [502, 504].includes(Number(status))
    ? ['사진을 반반 나눠서 다시 촬영해 주세요.']
    : [500, 503].includes(Number(status))
      ? ['잠시 후에 다시 시도해 주세요.']
      : solutions;

  return {
    title: data?.title || data?.error || `분석 실패 (${status})`,
    reason: data?.reason || '요청을 처리하는 중 오류가 발생했습니다.',
    solutions: statusSolutions.length ? statusSolutions : ['잠시 후 같은 사진으로 다시 시도해 주세요.'],
    code: data?.code || 'UNKNOWN_ERROR',
    status,
    detail: data?.detail || data?.preview || '',
    errorSource: data?.errorSource || '',
    responseContentType: data?.responseContentType || '',
    responseBody: data?.responseBody || '',
    requestId: data?.requestId || '',
    elapsedMs: Math.max(0, Number(data?.elapsedMs) || 0)
  };
}

async function readAnalysisResponse(response, startedAt, onProgress = () => {}) {
  const responseContentType = response.headers.get('content-type') || '';
  const requestId = response.headers.get('x-nf-request-id') || response.headers.get('x-request-id') || '';
  let rawText = '';
  let data;

  if (responseContentType.includes('text/event-stream') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalEvent = null;
    const consumeLines = (flush = false) => {
      const lines = buffer.split(/\r?\n/);
      buffer = flush ? '' : (lines.pop() || '');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        const event = JSON.parse(payload);
        if (event?.type === 'progress') onProgress(event.stage || 'AI_ANALYZING');
        if (event?.type === 'result') finalEvent = event;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      rawText += text;
      buffer += text;
      consumeLines(false);
    }
    const tail = decoder.decode();
    rawText += tail;
    buffer += tail;
    consumeLines(true);

    if (finalEvent) {
      return {
        ...(finalEvent.data || {}),
        _httpStatus: Math.max(100, Number(finalEvent.status) || 500)
      };
    }
    return {
      title: '분석 스트림 연결 종료',
      reason: '최종 분석 결과가 도착하기 전에 스트림 연결이 종료되었습니다.',
      solution: ['사진을 나눈 뒤 다시 분석해 주세요.'],
      code: 'STREAM_INTERRUPTED',
      status: 504,
      _httpStatus: 504,
      errorSource: 'NETLIFY',
      responseContentType,
      responseBody: rawText.slice(0, 2000),
      requestId,
      elapsedMs: Math.max(0, Date.now() - startedAt)
    };
  } else {
    rawText = await response.text();
  }

  try {
    if (!rawText) throw new Error('EMPTY_RESPONSE_BODY');
    data = JSON.parse(rawText);
  } catch {
    const gatewayTimeout = response.status === 504;
    data = {
      title: gatewayTimeout ? 'Netlify 게이트웨이 시간 초과' : '오류 응답 해석 실패',
      reason: gatewayTimeout
        ? '분석 함수가 완료되기 전에 Netlify 게이트웨이가 연결을 종료했습니다.'
        : '서버가 JSON이 아닌 오류 응답을 반환했습니다.',
      solution: gatewayTimeout
        ? ['사진을 나눈 뒤 다시 분석해 주세요.']
        : ['잠시 후 다시 분석해 주세요.'],
      code: gatewayTimeout ? 'NETLIFY_GATEWAY_TIMEOUT' : 'INVALID_ERROR_RESPONSE',
      status: response.status,
      errorSource: gatewayTimeout ? 'NETLIFY' : 'UNKNOWN',
      responseContentType,
      responseBody: rawText.slice(0, 2000),
      requestId,
      elapsedMs: Math.max(0, Date.now() - startedAt)
    };
  }

  if (!response.ok) {
    data = {
      ...data,
      status: Number(data?.status) || response.status,
      responseContentType: data?.responseContentType || responseContentType,
      requestId: data?.requestId || requestId,
      elapsedMs: Math.max(0, Number(data?.elapsedMs) || (Date.now() - startedAt))
    };
  }

  return data;
}

function AnalysisErrorCard({ error }) {
  if (!error) return null;
  const info = typeof error === 'string' ? { status: 500 } : error;
  const errorNumber = Number(info?.status) || 500;
  const helpText = [502, 504].includes(errorNumber)
    ? '사진을 반반 나눠서 다시 촬영해 주세요.'
    : [500, 503].includes(errorNumber)
      ? '잠시 후에 다시 시도해 주세요.'
      : (info?.solutions?.[0] || '다시 한번 시도해 주세요.');

  return (
    <div className="analysisError" role="alert">
      <div className="analysisErrorTitle">오류번호: {errorNumber}</div>
      <p className="analysisErrorSimpleHelp">해결방법: {helpText}</p>
    </div>
  );
}

function SplitModal({ item, onApply, onClose }) {
  const [direction, setDirection] = useState('vertical');
  const [position, setPosition] = useState(50);
  const [working, setWorking] = useState(false);

  async function apply() {
    setWorking(true);
    try {
      await onApply(direction, position);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="splitModalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && !working && onClose()}>
      <section className="splitModal" role="dialog" aria-modal="true" aria-label="사진 분할 위치 선택">
        <header><div><span>사진 나누기</span><strong>방향과 분할선을 선택하세요</strong></div><button disabled={working} onClick={onClose}>×</button></header>
        <div className="splitDirectionButtons">
          <button className={direction === 'vertical' ? 'active' : ''} onClick={() => setDirection('vertical')}>좌우 분할</button>
          <button className={direction === 'horizontal' ? 'active' : ''} onClick={() => setDirection('horizontal')}>위아래 분할</button>
        </div>
        <div className="splitPreview">
          <img src={item.preview} alt={item.name} />
          <span className={`splitGuide ${direction}`} style={direction === 'vertical' ? { left: `${position}%` } : { top: `${position}%` }} />
        </div>
        <label className="splitRange"><span>분할 위치 <b>{position}%</b></span><input type="range" min="20" max="80" step="1" value={position} onChange={(event) => setPosition(Number(event.target.value))}/></label>
        <p>빨간 선을 기준으로 두 장을 만듭니다. 문제나 수식의 가운데를 피해서 조절해 주세요.</p>
        <div className="splitModalActions"><button disabled={working} onClick={onClose}>취소</button><button className="primary" disabled={working} onClick={apply}>{working ? '나누는 중...' : '두 장으로 나누기'}</button></div>
      </section>
    </div>
  );
}



function CropModal({ item, onClose, onApply }) {
  const cropperRef = useRef(null);
  const eraserCanvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [eraserMode, setEraserMode] = useState(false);
  const [brushSize, setBrushSize] = useState(36);

  function getCropper() {
    return cropperRef.current?.cropper || null;
  }

  async function handleApply() {
    const cropper = getCropper();
    if ((!cropper && !eraserMode) || saving) return;

    setSaving(true);
    setError('');
    try {
      const canvas = eraserMode ? eraserCanvasRef.current : cropper.getCroppedCanvas({
          maxWidth: 2400,
          maxHeight: 2400,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high'
        });
      if (!canvas) throw new Error('선택한 영역을 읽지 못했습니다.');

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('편집한 이미지를 만들지 못했습니다.');

      const baseName = String(item.name || 'photo').replace(/\.[^.]+$/, '');
      const file = new File([blob], `${baseName}-edited.jpg`, { type: 'image/jpeg' });
      await onApply(file);
    } catch (err) {
      setError(err?.message || '사진 편집에 실패했습니다.');
      setSaving(false);
    }
  }

  function resetEdit() {
    const cropper = getCropper();
    if (!cropper) return;
    cropper.reset();
    cropper.setAspectRatio(NaN);
    setEraserMode(false);
    setError('');
  }

  function startEraser() {
    const cropper = getCropper();
    const canvas = eraserCanvasRef.current;
    if (!cropper || !canvas) return;
    const source = cropper.getCroppedCanvas({ maxWidth: 2400, maxHeight: 2400, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    if (!source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0);
    setEraserMode(true);
    setError('');
  }

  function pointFromEvent(event) {
    const canvas = eraserCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function beginErase(event) {
    if (!eraserMode) return;
    event.preventDefault();
    drawingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointFromEvent(event);
    const context = eraserCanvasRef.current.getContext('2d');
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.strokeStyle = '#ffffff';
    context.lineWidth = brushSize * (eraserCanvasRef.current.width / eraserCanvasRef.current.getBoundingClientRect().width);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  }

  function continueErase(event) {
    if (!drawingRef.current || !eraserMode) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const context = eraserCanvasRef.current.getContext('2d');
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function endErase() {
    drawingRef.current = false;
  }

  return (
    <div className="cropModalBackdrop" role="dialog" aria-modal="true" aria-label="사진 편집">
      <div className="cropModal">
        <div className="cropModalHeader">
          <div>
            <strong>사진 편집</strong>
            <p>분석할 영역을 조절하고 불필요한 부분을 지울 수 있습니다.</p>
          </div>
          <button type="button" className="cropClose" onClick={onClose} disabled={saving} aria-label="닫기">×</button>
        </div>

        <div className="cropStage borderCropStage">
          <div className={eraserMode ? 'cropperHidden' : 'cropperVisible'}>
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
          <canvas
            ref={eraserCanvasRef}
            className={`eraserCanvas ${eraserMode ? 'active' : ''}`}
            onPointerDown={beginErase}
            onPointerMove={continueErase}
            onPointerUp={endErase}
            onPointerCancel={endErase}
            onPointerLeave={endErase}
          />
        </div>

        <div className="cropControls borderCropControls">
          <div className="cropQuickControls">
            <button type="button" disabled={eraserMode} onClick={() => getCropper()?.zoom(0.1)}>확대 +</button>
            <button type="button" disabled={eraserMode} onClick={() => getCropper()?.zoom(-0.1)}>축소 −</button>
            <button type="button" disabled={eraserMode} onClick={() => getCropper()?.rotate(-90)}>왼쪽 회전</button>
            <button type="button" disabled={eraserMode} onClick={() => getCropper()?.rotate(90)}>오른쪽 회전</button>
            <button type="button" className={eraserMode ? 'active' : ''} onClick={startEraser}>지우개</button>
            <button type="button" onClick={resetEdit}>초기화</button>
          </div>
          {eraserMode ? (
            <label className="eraserSize">지우개 크기<input type="range" min="12" max="100" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><span>{brushSize}px</span></label>
          ) : null}
          <p className="cropHelp">{eraserMode ? '사진 위를 손가락이나 마우스로 문질러 지우세요. 초기화를 누르면 모든 편집이 취소됩니다.' : '흰색 테두리를 움직여 영역을 조절한 뒤, 필요하면 지우개를 선택하세요.'}</p>
          {error ? <div className="cropError">{error}</div> : null}
        </div>

        <div className="cropModalActions">
          <button type="button" className="cropCancel" onClick={onClose} disabled={saving}>취소</button>
          <button type="button" className="cropApply" onClick={handleApply} disabled={saving}>{saving ? '저장 중...' : '편집 완료'}</button>
        </div>
      </div>
    </div>
  );
}

function VerdictDialog({ current, currentErrorType = '', onSave, onClose }) {
  const initialVerdict = current === '틀림' ? '틀림' : '맞음';
  const [verdict, setVerdict] = useState(initialVerdict);
  const [errorType, setErrorType] = useState(currentErrorType);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="verdictDialogBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="verdictDialog" role="dialog" aria-modal="true" aria-label="판정 변경">
        <div className="verdictDialogHeader">
          <strong>판정·오류유형 변경</strong>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="verdictChoices">
          <button type="button" className={verdict === '맞음' ? 'correct selected' : 'correct'} onClick={() => { setVerdict('맞음'); setErrorType(''); }}>
            <span aria-hidden="true">✓</span> 맞음
          </button>
          <button type="button" className={verdict === '틀림' ? 'incorrect selected' : 'incorrect'} onClick={() => setVerdict('틀림')}>
            <span aria-hidden="true">×</span> 틀림
          </button>
        </div>
        {verdict === '틀림' ? (
          <div className="errorTypeEditor">
            <span>오류유형</span>
            <div>
              <button type="button" className={errorType === '계산오류' ? 'selected' : ''} onClick={() => setErrorType('계산오류')}>계산오류</button>
              <button type="button" className={errorType === '개념오류' ? 'selected' : ''} onClick={() => setErrorType('개념오류')}>개념오류</button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="verdictSaveButton"
          disabled={verdict === '틀림' && !errorType}
          onClick={() => onSave(verdict, verdict === '틀림' ? errorType : '')}
        >
          변경 완료
        </button>
      </div>
    </div>
  );
}

function normalizeStudentName(value) {
  return String(value || '').replace(/\s+/g, '').slice(0, 30);
}

function kstWeekKey(value = new Date()) {
  const shifted = new Date(new Date(value).getTime() + (9 * 60 * 60 * 1000));
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const day = new Date(midnight).getUTCDay();
  return new Date(midnight - (((day + 6) % 7) * 86400000)).toISOString().slice(0, 10);
}

function aggregateWeek(records, weekKey) {
  const result = { total: 0, correct: 0, incorrect: 0, review: 0, calculation: 0, concept: 0 };
  (records || []).filter((row) => kstWeekKey(row.analyzed_at) === weekKey).forEach((row) => {
    result.total += Number(row.total_count || 0);
    result.correct += Number(row.correct_count || 0);
    result.incorrect += Number(row.incorrect_count || 0);
    result.review += Number(row.review_count || 0);
    result.calculation += Number(row.calculation_errors || 0);
    result.concept += Number(row.concept_errors || 0);
  });
  result.correctRate = result.total ? Number(((result.correct / result.total) * 100).toFixed(1)) : 0;
  return result;
}

function StudentSummaryDialog({ studentName, summary, weeklyRecords, weeklyLoading, onClose }) {
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const thisWeekKey = kstWeekKey();
  const previousWeekKey = new Date(`${thisWeekKey}T00:00:00Z`);
  previousWeekKey.setUTCDate(previousWeekKey.getUTCDate() - 7);
  const thisWeek = aggregateWeek(weeklyRecords, thisWeekKey);
  const lastWeek = aggregateWeek(weeklyRecords, previousWeekKey.toISOString().slice(0, 10));

  function delta(field, rate = false) {
    const value = Number(thisWeek[field] || 0) - Number(lastWeek[field] || 0);
    return `${value > 0 ? '+' : ''}${value.toFixed(rate ? 1 : 0)}${rate ? '%p' : ''}`;
  }

  function deltaClass(field, higherIsBetter = false) {
    const value = Number(thisWeek[field] || 0) - Number(lastWeek[field] || 0);
    if (!value) return 'same';
    const improved = higherIsBetter ? value > 0 : value < 0;
    return improved ? 'improved' : 'declined';
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const shareText = [
    '[주간 풀이 분석]',
    '',
    `학생: ${studentName || '(학생 이름을 입력해 주세요)'}`,
    `이번 주 분석: ${thisWeek.total}문제`,
    `정답률: 지난주 ${lastWeek.correctRate}% → 이번 주 ${thisWeek.correctRate}%`,
    '',
    '오류 유형(지난주 → 이번 주)',
    `계산오류: ${lastWeek.calculation}개 → ${thisWeek.calculation}개`,
    `개념오류: ${lastWeek.concept}개 → ${thisWeek.concept}개`
  ].join('\n');

  async function copyShareText(message) {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    alert(message);
  }

  async function share() {
    if (!isMobileDevice) {
      await copyShareText('분석 결과가 복사되었습니다. PC 카카오톡 대화창에서 Ctrl+V로 붙여넣어 주세요.');
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({ title: '주간 풀이 분석', text: shareText });
        return;
      }
      await copyShareText('분석 결과가 복사되었습니다. 카카오톡 대화창에 붙여넣어 주세요.');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        await copyShareText('분석 결과가 복사되었습니다. 카카오톡 대화창에 붙여넣어 주세요.');
      }
    }
  }

  return (
    <div className="studentSummaryBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="studentSummaryDialog" role="dialog" aria-modal="true" aria-label="학생 학습 분석">
        <header>
          <div><span>오늘의 학습 분석</span><strong>{studentName || '학생 이름 미입력'}</strong></div>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>
        {weeklyLoading ? <p className="weeklyLoading">주간 데이터를 불러오는 중...</p> : (
          <>
            <div className="weeklyComparisonTitle"><strong>지난주·이번 주 비교</strong><span>월요일~일요일</span></div>
            <div className="weeklyComparisonTable">
              <div className="weeklyHead"><span>항목</span><b>지난주</b><b>이번 주</b><b>변화</b></div>
              <div><span>분석 문제</span><b>{lastWeek.total}</b><b>{thisWeek.total}</b><em className="neutral">{delta('total')}</em></div>
              <div><span>정답률</span><b>{lastWeek.correctRate}%</b><b>{thisWeek.correctRate}%</b><em className={deltaClass('correctRate', true)}>{delta('correctRate', true)}</em></div>
              <div><span>계산오류</span><b>{lastWeek.calculation}</b><b>{thisWeek.calculation}</b><em className={deltaClass('calculation')}>{delta('calculation')}</em></div>
              <div><span>개념오류</span><b>{lastWeek.concept}</b><b>{thisWeek.concept}</b><em className={deltaClass('concept')}>{delta('concept')}</em></div>
            </div>
          </>
        )}
        <button type="button" className="studentShareButton" onClick={share}>
          {isMobileDevice ? '카카오톡 공유하기' : '분석 결과 복사'}
        </button>
      </section>
    </div>
  );
}

function StudentRecordsDialog({ records, loading, onSelect, onDelete, onClose }) {
  const grouped = Object.values((records || []).reduce((map, row) => {
    const name = row.student_name;
    if (!map[name]) map[name] = { name, rows: [], latest: row.analyzed_at };
    map[name].rows.push(row);
    if (new Date(row.analyzed_at) > new Date(map[name].latest)) map[name].latest = row.analyzed_at;
    return map;
  }, {})).sort((a, b) => new Date(b.latest) - new Date(a.latest));
  const thisWeekKey = kstWeekKey();
  const previous = new Date(`${thisWeekKey}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 7);

  return (
    <div className="studentSummaryBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="studentRecordsDialog" role="dialog" aria-modal="true" aria-label="전체 학생 기록 관리">
        <header><div><span>최근 3주</span><strong>전체 학생 기록</strong></div><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
        {loading ? <p className="weeklyLoading">학생 기록을 불러오는 중...</p> : grouped.length ? (
          <div className="studentRecordList">{grouped.map((student) => {
            const current = aggregateWeek(student.rows, thisWeekKey);
            const last = aggregateWeek(student.rows, previous.toISOString().slice(0, 10));
            return <article key={student.name}>
              <button className="studentRecordMain" type="button" onClick={() => onSelect(student.name)}>
                <strong>{student.name}</strong>
                <span>이번 주 {current.total}문제 · 정답률 {current.correctRate}%</span>
                <small>지난주 {last.correctRate}% → 이번 주 {current.correctRate}%</small>
              </button>
              <button className="studentRecordDelete" type="button" onClick={() => onDelete(student.name)}>기록 삭제</button>
            </article>;
          })}</div>
        ) : <div className="studentRecordsEmpty">최근 3주 동안 저장된 학생 기록이 없습니다.</div>}
        <p className="studentRetentionNote">3주가 지난 데이터는 매일 자동 삭제됩니다.</p>
      </section>
    </div>
  );
}

function submissionDateKey(value) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
}

function TeacherSubmissionDay({ studentName, date, rows, onDelete, onUpdate, onClose }) {
  const [dayRows,setDayRows]=useState(()=>[...rows].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
  const [hideCorrect,setHideCorrect]=useState(false), [lightbox,setLightbox]=useState(null), [editTarget,setEditTarget]=useState(null);
  function openEdit(rowId,problemIndex,current,currentErrorType){setEditTarget({rowId,problemIndex,current,currentErrorType});}
  async function saveEdit(verdict,errorType){const row=dayRows.find(x=>x.id===editTarget.rowId);const problems=(row?.analysis_result?.problems||[]).map((p,i)=>i===editTarget.problemIndex?{...p,originalVerdict:p.originalVerdict||p.verdict||'확인 필요',verdict,errorType:verdict==='틀림'?errorType:'',manuallyChanged:true}:p);await onUpdate(row.id,problems);setDayRows(previous=>previous.map(x=>x.id===row.id?{...x,analysis_result:{...x.analysis_result,problems}}:x));setEditTarget(null);}
  return <div className="studentSummaryBackdrop teacherDayBackdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="teacherSubmissionDay"><header><div><span>{studentName}</span><strong>{date} 풀이 분석</strong><small>사진 {dayRows.length}장</small></div><div className="teacherDayHeaderActions"><button className={hideCorrect?'active':''} onClick={()=>setHideCorrect(x=>!x)}>{hideCorrect?'맞음 포함하기':'맞음 제외하기'}</button><button className="teacherDayClose" onClick={onClose}>×</button></div></header><div className="teacherSubmissionStream">{dayRows.map((row,index)=><article key={row.id}><div className="teacherSubmissionPhoto"><strong>학생 풀이 {index+1}</strong><span>{new Date(row.created_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</span><button onClick={()=>setLightbox({src:row.image_url,alt:`${studentName} 풀이 ${index+1}`})}><img src={row.image_url} alt={`${studentName} 풀이 ${index+1}`}/></button></div><ResultCard item={{result:row.analysis_result}} hideCorrect={hideCorrect} onCopy={()=>navigator.clipboard.writeText(JSON.stringify(row.analysis_result?.problems||[]))} onChangeVerdict={(problemIndex,current,currentErrorType)=>openEdit(row.id,problemIndex,current,currentErrorType)}/><button className="teacherSubmissionDelete" onClick={()=>onDelete(row.id)}>제출 삭제</button></article>)}</div></section>{editTarget?<VerdictDialog current={editTarget.current} currentErrorType={editTarget.currentErrorType} onSave={saveEdit} onClose={()=>setEditTarget(null)}/>:null}{lightbox?<ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={()=>setLightbox(null)}/>:null}</div>;
}

function StudentAccessManager({ token, onClose }) {
  const [students,setStudents]=useState([]), [submissions,setSubmissions]=useState([]), [name,setName]=useState(''), [loading,setLoading]=useState(true);
  const [issuedCode,setIssuedCode]=useState(null);
  const [selectedDay,setSelectedDay]=useState(null);
  async function load(){ setLoading(true); try{ const d=await apiRequest('students-api',{token}); setStudents(d.students||[]); setSubmissions(d.submissions||[]); }catch(e){alert(e.message);}finally{setLoading(false);} }
  useEffect(()=>{load();},[]);
  async function create(){ if(!name.trim())return; const d=await apiRequest('students-api',{method:'POST',token,body:{action:'create',studentName:name}}); setIssuedCode({name:name.trim(),code:d.accessCode}); setName(''); await load(); }
  async function act(body){ const d=await apiRequest('students-api',{method:'POST',token,body}); if(d.accessCode){ const s=students.find(x=>x.id===body.studentId); setIssuedCode({name:s?.student_name||'학생',code:d.accessCode}); } await load(); }
  async function removeSubmission(id){ if(!confirm('이 제출 사진과 상세분석을 삭제할까요?'))return; await fetch(`/.netlify/functions/students-api?submissionId=${encodeURIComponent(id)}`,{method:'DELETE',headers:apiHeaders(token)}); setSelectedDay(null); await load(); }
  async function updateSubmission(id,problems){await apiRequest('students-api',{method:'POST',token,body:{action:'update_submission',submissionId:id,problems}});setSubmissions(previous=>previous.map(x=>x.id===id?{...x,analysis_result:{...x.analysis_result,problems}}:x));}
  return <div className="studentSummaryBackdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="studentAccessDialog"><header><div><span>학생용 촬영·분석</span><strong>학생 접속 관리</strong></div><button onClick={onClose}>×</button></header>
    <div className="studentCreateRow"><input value={name} onChange={e=>setName(e.target.value.slice(0,30))} placeholder="학생 이름"/><button onClick={create}>학생 등록·코드 발급</button></div>
    {issuedCode?<div className="issuedCode"><div><span>{issuedCode.name} 접속코드</span><strong>{issuedCode.code}</strong></div><button onClick={()=>navigator.clipboard.writeText(`풀이체커 학생용\n${location.origin}/student\n접속코드: ${issuedCode.code}`)}>링크·코드 복사</button><small>보안을 위해 코드는 지금만 표시됩니다.</small></div>:null}
    {loading?<p className="weeklyLoading">불러오는 중...</p>:<div className="accessStudentList">{students.map(s=>{const rows=submissions.filter(x=>x.student_id===s.id);const days=Object.entries(rows.reduce((map,row)=>{const key=submissionDateKey(row.created_at);(map[key]||=[]).push(row);return map;},{})).sort((a,b)=>new Date(b[1][0].created_at)-new Date(a[1][0].created_at));return <article key={s.id}><div className="accessStudentHead"><div><strong>{s.student_name}</strong><span>{s.active?'사용 중':'사용 중지'} · 3일 내 제출 {rows.length}건</span></div><button onClick={()=>act({action:'regenerate',studentId:s.id})}>코드 재발급</button><button onClick={()=>act({action:'toggle',studentId:s.id,active:!s.active})}>{s.active?'사용 중지':'사용 재개'}</button></div><div className="submissionDayList">{days.map(([date,dayRows])=><button key={date} onClick={()=>setSelectedDay({studentName:s.student_name,date,rows:dayRows})}><div><strong>{date}</strong><span>사진 {dayRows.length}장 · 총 {dayRows.reduce((n,r)=>n+(r.analysis_result?.problems?.length||0),0)}문제</span></div><em>상세분석 ›</em></button>)}</div></article>})}</div>}
    {selectedDay?<TeacherSubmissionDay {...selectedDay} onDelete={removeSubmission} onUpdate={updateSubmission} onClose={()=>setSelectedDay(null)}/>:null}
  </section></div>;
}

function StudentApp() {
  const [token,setToken]=useState(localStorage.getItem('math_checker_student_token')||''), [student,setStudent]=useState(null), [code,setCode]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [items,setItems]=useState([]), [analysisMode,setAnalysisMode]=useState('MEDIUM');
  const [splitTarget,setSplitTarget]=useState(null);
  useEffect(()=>{if(token)apiRequest('student-access',{token}).then(d=>setStudent(d.student)).catch(()=>{localStorage.removeItem('math_checker_student_token');setToken('');});},[token]);
  async function login(e){e.preventDefault();setError('');try{const d=await apiRequest('student-access',{method:'POST',body:{code}});localStorage.setItem('math_checker_student_token',d.token);setToken(d.token);setStudent(d.student);}catch(x){setError(x.message);}}
  function add(files){setItems(Array.from(files||[]).filter(f=>f.type.startsWith('image/')).slice(0,10).map((file,i)=>({id:`${Date.now()}-${i}`,file,name:file.name,preview:URL.createObjectURL(file),status:'ready',result:null,error:null})));}
  function removeLocal(id){setItems(p=>{const target=p.find(x=>x.id===id);if(target?.preview)URL.revokeObjectURL(target.preview);return p.filter(x=>x.id!==id);});}
  async function splitLocal(direction,position){
    const item=splitTarget;
    if(!item)return;
    if(busy)return;
    try{
      const halves=await splitImage(item.file,direction,position);
      const replacement=halves.map((file,index)=>({id:`${Date.now()}-${index}-${file.name}`,file,name:file.name,preview:URL.createObjectURL(file),status:'ready',result:null,error:null,splitFromError:item.status==='error'}));
      setItems(previous=>previous.flatMap(current=>{
        if(current.id!==item.id)return [current];
        if(current.preview)URL.revokeObjectURL(current.preview);
        return replacement;
      }));
      setSplitTarget(null);
    }catch(error){alert(error.message||'사진을 나누지 못했습니다.');}
  }
  async function analyzeOneStudent(item, selectedMode=analysisMode){
    try {
      setItems(p=>p.map(x=>x.id===item.id?{...x,status:'analyzing',error:null}:x));
      const imageDataUrl=await compressImageToDataUrl(item.file);
      let res;
      let data;
      for(let attempt=0;attempt<2;attempt+=1){
        const requestStartedAt=Date.now();
        res=await fetch('/.netlify/functions/analyze',{method:'POST',headers:apiHeaders(token),body:JSON.stringify({imageDataUrl,fileName:item.name,analysisMode:selectedMode})});
        data=await readAnalysisResponse(res,requestStartedAt,(stage)=>setItems(p=>p.map(x=>x.id===item.id?{...x,analysisStage:stage}:x)));
        const responseStatus=Number(data?._httpStatus)||res.status;
        const retryable=[500,503].includes(responseStatus);
        const remaining=data?.account?Math.max(0,Number(data.account.limit_count||0)-Number(data.account.used_count||0)):1;
        if(attempt===0&&retryable&&remaining>0){
          setItems(p=>p.map(x=>x.id===item.id?{...x,status:'retrying'}:x));
          await new Promise(resolve=>setTimeout(resolve,5000));
          setItems(p=>p.map(x=>x.id===item.id?{...x,status:'analyzing'}:x));
          continue;
        }
        break;
      }
      const finalStatus=Number(data?._httpStatus)||res.status;
      if(finalStatus>=400)throw normalizeErrorPayload(data,finalStatus);
      await apiRequest('student-access',{method:'POST',token,body:{recordId:item.id,fileName:item.name,imageDataUrl,problems:data.problems||[]}});
      setItems(p=>p.map(x=>x.id===item.id?{...x,status:'done',result:null,error:null}:x));
    }catch(e){setItems(p=>p.map(x=>x.id===item.id?{...x,status:'error',result:null,error:e}:x));}
  }
  async function analyze(){
    if(!items.length||busy)return;
    setBusy(true);
    const selectedMode=analysisMode;
    const queue=items.filter(x=>x.status==='ready'||x.status==='error');
    let nextIndex=0;
    async function worker(){while(nextIndex<queue.length){const item=queue[nextIndex];nextIndex+=1;await analyzeOneStudent(item,selectedMode);}}
    const workerCount=Math.min(2,queue.length);
    await Promise.all(Array.from({length:workerCount},()=>worker()));
    setBusy(false);
  }
  async function retry(item){if(busy)return;setBusy(true);await analyzeOneStudent(item);setBusy(false);}
  if(!token||!student)return <main className="studentPortal"><section className="studentLoginCard"><div className="brandMark">✓</div><span>풀이체커 학생용</span><h1>내 풀이 촬영하기</h1><p>선생님에게 받은 6자리 접속코드를 입력하세요.</p><form onSubmit={login}><input inputMode="numeric" maxLength="6" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="6자리 접속코드"/>{error?<div className="authAlert error">{error}</div>:null}<button>시작하기</button></form></section></main>;
  return <main className="studentPortal"><header className="studentPortalTop"><div><span>풀이체커</span><strong>{student.name} 학생</strong></div><button onClick={()=>{localStorage.removeItem('math_checker_student_token');setToken('');setStudent(null);}}>코드 변경</button></header><section className="studentUploadCard"><h1>풀이 사진을 올려주세요</h1><p>최대 10장까지 촬영하거나 선택할 수 있어요.</p><div className="studentModeToggle"><button className={analysisMode==='MEDIUM'?'active':''} disabled={busy} onClick={()=>setAnalysisMode('MEDIUM')}>MED</button><button className={analysisMode==='GENERAL'?'active':''} disabled={busy} onClick={()=>setAnalysisMode('GENERAL')}>LOW</button></div><label><input type="file" accept="image/*" capture="environment" multiple hidden onChange={e=>add(e.target.files)}/>사진 촬영·선택</label><button disabled={!items.some(x=>x.status==='ready'||x.status==='error')||busy} onClick={analyze}>{busy?'분석 중...':'분석 시작'}</button></section><section className="studentItemList">{items.map(item=><article key={item.id}><img src={item.preview} alt={item.name}/><div><strong>{item.name}</strong>{item.status==='ready'?<p>분석할 준비가 됐어요.</p>:null}{item.status==='analyzing'?<p>{analysisStageText(item.analysisStage)}</p>:null}{item.status==='retrying'?<p>일시 오류로 5초 후 자동 재시도 중입니다...</p>:null}{item.status==='done'?<p className="studentSuccess">✓ 분석 성공</p>:null}{item.splitFromError&&item.status==='ready'?<button className="studentRetry" disabled={busy} onClick={()=>retry(item)}>재분석</button>:null}{item.status==='error'?<><AnalysisErrorCard error={item.error}/>{[502,504].includes(Number(item.error?.status))?<button className="studentRetry" disabled={busy} onClick={()=>setSplitTarget(item)}>사진 나누기</button>:null}<button className="studentRetry" disabled={busy} onClick={()=>retry(item)}>재분석</button></>:null}<button className="studentLocalDelete" disabled={item.status==='analyzing'||item.status==='retrying'} onClick={()=>removeLocal(item.id)}>삭제</button></div></article>)}</section><p className="studentPrivacyNote">사진과 상세분석은 3일 후 자동 삭제됩니다.</p>{splitTarget?<SplitModal item={splitTarget} onApply={splitLocal} onClose={()=>setSplitTarget(null)}/>:null}</main>;
}

function ImageLightbox({ src, alt, onClose }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const pointersRef = useRef(new Map());
  const lastPointRef = useRef(null);
  const pinchRef = useRef(null);
  const mouseCleanupRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      mouseCleanupRef.current?.();
    };
  }, [onClose]);

  function clampScale(value) {
    return Math.min(5, Math.max(1, value));
  }

  function pointerDistance(points) {
    const [first, second] = points;
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length === 1) lastPointRef.current = points[0];
    if (points.length === 2) pinchRef.current = { distance: pointerDistance(points), scale };
  }

  function handlePointerMove(event) {
    if (event.pointerType === 'mouse') return;
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];
    if (points.length >= 2 && pinchRef.current) {
      const nextScale = clampScale(pinchRef.current.scale * (pointerDistance(points) / Math.max(1, pinchRef.current.distance)));
      setScale(nextScale);
      if (nextScale === 1) setPosition({ x: 0, y: 0 });
      return;
    }
    if (points.length === 1 && lastPointRef.current && scale > 1) {
      const point = points[0];
      const previousPoint = lastPointRef.current;
      setPosition((current) => ({ x: current.x + point.x - previousPoint.x, y: current.y + point.y - previousPoint.y }));
      lastPointRef.current = point;
    }
  }

  function handlePointerEnd(event) {
    if (event.pointerType === 'mouse') return;
    pointersRef.current.delete(event.pointerId);
    const points = [...pointersRef.current.values()];
    pinchRef.current = null;
    lastPointRef.current = points[0] || null;
  }

  function handleWheel(event) {
    event.preventDefault();
    const nextScale = clampScale(scale * (event.deltaY < 0 ? 1.15 : 0.87));
    setScale(nextScale);
    if (nextScale === 1) setPosition({ x: 0, y: 0 });
  }

  function handleMouseDown(event) {
    if (event.button !== 0 || scale <= 1) return;
    event.preventDefault();
    let lastX = event.clientX;
    let lastY = event.clientY;

    const handleMouseMove = (moveEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - lastX;
      const deltaY = moveEvent.clientY - lastY;
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      setPosition((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
    };

    const stopMouseDrag = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopMouseDrag);
      window.removeEventListener('blur', stopMouseDrag);
      mouseCleanupRef.current = null;
    };

    mouseCleanupRef.current?.();
    mouseCleanupRef.current = stopMouseDrag;
    window.addEventListener('mousemove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', stopMouseDrag);
    window.addEventListener('blur', stopMouseDrag);
  }

  return (
    <div className="imageLightbox" role="dialog" aria-modal="true" aria-label="사진 확대" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <button type="button" className="lightboxClose" onClick={onClose} aria-label="닫기">×</button>
      <div
        className={`lightboxStage ${scale > 1 ? 'zoomed' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
      >
        <img src={src} alt={alt} draggable="false" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }} />
      </div>
      <p className="lightboxHint">휠로 확대한 뒤 마우스로 끌어 이동</p>
    </div>
  );
}

function ResultCard({ item, onCopy, onChangeVerdict, hideCorrect, readOnly = false }) {
  const allProblems = Array.isArray(item.result?.problems) ? item.result.problems : [];
  const problems = hideCorrect
    ? allProblems
        .map((problem, originalIndex) => ({ problem, originalIndex }))
        .filter(({ problem }) => problem?.verdict !== '맞음')
    : allProblems.map((problem, originalIndex) => ({ problem, originalIndex }));

  if (!problems.length) {
    return <div className="errorBox small">{hideCorrect ? '틀림·확인 필요 문제가 없습니다.' : '학생이 작성한 풀이가 없습니다.'}</div>;
  }

  return (
    <div className="result">
      {problems.map(({ problem, originalIndex }, index) => {
        const number = String(problem?.number || originalIndex + 1).trim();
        const verdict = problem?.verdict || '확인 필요';
        const message = String(problem?.message || verdict).trim();
        const studentExpression = String(problem?.studentExpression || '').trim();
        const correctExpression = String(problem?.correctExpression || '').trim();
        const errorType = verdict === '틀림' ? String(problem?.errorType || '').trim() : '';
        const originalVerdict = problem?.originalVerdict || verdict;
        const canShowOriginalError = !problem?.manuallyChanged || originalVerdict === '틀림';
        const showMessage = verdict !== '맞음' && verdict !== '틀림' && canShowOriginalError && message && message !== verdict && message !== '맞음';
        const showEvidence = verdict === '틀림' && canShowOriginalError && studentExpression && correctExpression;

        return (
          <div className="resultBlock" key={`${number}-${index}`}>
            <div className="resultHeading">
              <span className="problemNumber">{number}번</span>
              <div className="verdictControls">
                <div className={`verdict ${getVerdictClass(verdict)}`}>{verdict}</div>
                {errorType ? <span className="errorTypeBadge">{errorType}</span> : null}
                {!readOnly ? <button type="button" className="verdictEditButton" onClick={() => onChangeVerdict(originalIndex, verdict, errorType)} aria-label={`${number}번 판정과 오류유형 변경`} title="판정·오류유형 변경">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg>
                </button> : null}
              </div>
            </div>
            {showEvidence && (
              <div className="evidencePanel">
                <div className="evidenceItem">
                  <span className="evidenceLabel">학생식</span>
                  <MathText text={toDisplayMath(studentExpression)} className="mathExpression" />
                </div>
                <div className="evidenceItem">
                  <span className="evidenceLabel">올바른 식</span>
                  <MathText text={toDisplayMath(correctExpression)} className="mathExpression correctMathExpression" />
                </div>
              </div>
            )}
            {showMessage && <MathText text={message} className="mathExplanation" />}
          </div>
        );
      })}

      {!readOnly ? <button className="copy" onClick={onCopy}>
        <span>결과 복사</span>
        <span aria-hidden="true">⧉</span>
      </button> : null}
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

function LoginScreen({ onLogin, onClose = null, modal = false, submitLabel = '로그인' }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!modal) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modal, onClose]);

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

  const card = (
      <section className={`authCard ${modal ? 'loginModalCard' : ''}`}>
        {modal ? <button type="button" className="loginModalClose" onClick={onClose} aria-label="닫기">×</button> : null}
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
          <button className="authSubmit" type="submit" disabled={busy}>{busy ? '로그인 중...' : submitLabel}</button>
        </form>
        <p className="authNote">회원가입 없이 관리자가 발급한 계정만 사용할 수 있습니다.</p>
      </section>
  );

  if (modal) {
    return <div className="loginModalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>{card}</div>;
  }
  return <main className="authPage">{card}</main>;
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

function CheckerApp({ auth, onLogin, onLogout, onAccountUpdate }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editTargetId, setEditTargetId] = useState(null);
  const [splitTarget, setSplitTarget] = useState(null);
  const [verdictTarget, setVerdictTarget] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);
  const [loginMode, setLoginMode] = useState(null);
  const [hideCorrect, setHideCorrect] = useState(false);
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0);
  const [analysisMode, setAnalysisMode] = useState('MEDIUM');
  const [studentName, setStudentName] = useState('');
  const [showStudentSummary, setShowStudentSummary] = useState(false);
  const [summaryStudentName, setSummaryStudentName] = useState('');
  const [weeklyRecords, setWeeklyRecords] = useState([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [showStudentRecords, setShowStudentRecords] = useState(false);
  const [showStudentAccess, setShowStudentAccess] = useState(false);
  const [allStudentRecords, setAllStudentRecords] = useState([]);
  const [allRecordsLoading, setAllRecordsLoading] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [recordId, setRecordId] = useState(() => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const inputRef = useRef(null);
  const requestControllersRef = useRef(new Map());
  const analysisStoppedRef = useRef(false);
  const account = auth?.account || null;
  const remaining = account ? Math.max(0, Number(account.limit_count || 0) - Number(account.used_count || 0)) : 0;

  const canAnalyze = useMemo(
    () => items.length > 0 && normalizeStudentName(studentName) && !busy && (!auth || remaining >= items.length),
    [items, studentName, busy, auth, remaining]
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



  function openEditor(id) {
    if (busy) return;
    setEditTargetId(id);
  }

  function closeEditor() {
    setEditTargetId(null);
  }

  async function applyEdit(file) {
    setItems((prev) => prev.map((item) => {
      if (item.id !== editTargetId) return item;
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
        edited: true,
        splitFromError: item.status === 'error'
      };
    }));
    setEditTargetId(null);
  }

  function removeItem(id) {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((x) => x.id !== id);
    });
  }

  async function applySplitItem(direction, position) {
    const item = splitTarget;
    if (!item) return;
    if (busy) return;
    try {
      const halves = await splitImage(item.file, direction, position);
      const replacement = halves.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        name: file.name,
        size: file.size,
        preview: URL.createObjectURL(file),
        status: 'ready',
        result: null,
        error: null,
        edited: true
      }));
      setItems((previous) => previous.flatMap((current) => {
        if (current.id !== item.id) return [current];
        if (current.preview) URL.revokeObjectURL(current.preview);
        return replacement;
      }));
      setSplitTarget(null);
    } catch (error) {
      alert(error?.message || '사진을 나누지 못했습니다.');
    }
  }

  function clearAll() {
    items.forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
    setItems([]);
    setEditTargetId(null);
    setVerdictTarget(null);
    setLightboxItem(null);
    setHideCorrect(false);
    setAnalysisElapsedSeconds(0);
    setStudentName('');
    setShowStudentSummary(false);
    setSummaryStudentName('');
    setWeeklyRecords([]);
    setShowStudentRecords(false);
    setShowStudentAccess(false);
    setAllStudentRecords([]);
    setSaveState('idle');
    setRecordId(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  }

  function openVerdictDialog(itemId, problemIndex, current, currentErrorType) {
    setVerdictTarget({ itemId, problemIndex, current, currentErrorType });
  }

  function changeVerdict(nextVerdict, nextErrorType) {
    if (!verdictTarget) return;
    setItems((previous) => previous.map((item) => {
      if (item.id !== verdictTarget.itemId || !Array.isArray(item.result?.problems)) return item;
      const problems = item.result.problems.map((problem, index) => {
        if (index !== verdictTarget.problemIndex) return problem;
        return {
          ...problem,
          originalVerdict: problem.originalVerdict || problem.verdict || '확인 필요',
          verdict: nextVerdict,
          errorType: nextVerdict === '틀림' ? nextErrorType : '',
          manuallyChanged: true
        };
      });
      return { ...item, result: { ...item.result, problems } };
    }));
    setVerdictTarget(null);
  }

  async function analyzeOne(item, sessionToken, selectedMode) {
    if (analysisStoppedRef.current) throw new DOMException('분석이 중단되었습니다.', 'AbortError');
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'compressing', error: null } : x));

    const imageDataUrl = await compressImageToDataUrl(item.file);
    if (analysisStoppedRef.current) throw new DOMException('분석이 중단되었습니다.', 'AbortError');

    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'analyzing' } : x));

    let res;
    let data;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        requestControllersRef.current.set(item.id, controller);
        const requestStartedAt = Date.now();
        res = await fetch('/.netlify/functions/analyze', {
          method: 'POST',
          headers: apiHeaders(sessionToken),
          signal: controller.signal,
          body: JSON.stringify({ imageDataUrl, fileName: item.name, analysisMode: selectedMode })
        });
        data = await readAnalysisResponse(res, requestStartedAt, (stage) => {
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, analysisStage: stage } : x));
        });
        if (data?.account) onAccountUpdate(data.account);

        const responseStatus = Number(data?._httpStatus) || res.status;
        const retryable = [500, 503].includes(responseStatus);
        const remainingAfterAttempt = data?.account
          ? Math.max(0, Number(data.account.limit_count || 0) - Number(data.account.used_count || 0))
          : 1;
        if (attempt === 0 && retryable && remainingAfterAttempt > 0) {
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'retrying' } : x));
          await new Promise((resolve) => setTimeout(resolve, 5000));
          if (analysisStoppedRef.current) throw new DOMException('분석이 중단되었습니다.', 'AbortError');
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'analyzing' } : x));
          continue;
        }
        break;
      }
    } finally {
      requestControllersRef.current.delete(item.id);
    }

    const finalStatus = Number(data?._httpStatus) || res.status;
    if (finalStatus >= 400) {
      throw normalizeErrorPayload(data, finalStatus);
    }
    return data;
  }

  async function logAnalysisError(error, sessionToken) {
    try {
      await fetch('/.netlify/functions/analysis-error-log', {
        method: 'POST',
        headers: apiHeaders(sessionToken),
        body: JSON.stringify({
          httpStatus: Number(error?.status) || 500,
          errorCode: String(error?.code || 'UNKNOWN_ERROR'),
          errorType: String(error?.title || '분석 실패'),
          errorSource: String(error?.errorSource || ''),
          responseContentType: String(error?.responseContentType || ''),
          responseBody: String(error?.responseBody || error?.detail || ''),
          requestId: String(error?.requestId || ''),
          elapsedMs: Math.max(0, Number(error?.elapsedMs) || 0)
        })
      });
    } catch {
      // 오류 기록 실패가 사용자의 재분석을 막지 않도록 조용히 무시합니다.
    }
  }

  async function reanalyzeItem(item) {
    if (!item || busy || (!item.result && item.status !== 'error' && !item.splitFromError)) return;
    if (!auth) {
      setLoginMode('login');
      return;
    }
    if (remaining < 1) {
      alert('남은 분석 가능 횟수가 없습니다. 관리자에게 분석 장수 추가를 요청해 주세요.');
      return;
    }

    const startedAt = performance.now();
    analysisStoppedRef.current = false;
    setBusy(true);
    try {
      const result = await analyzeOne(item, auth.token, analysisMode);
      setItems((prev) => prev.map((x) => (
        x.id === item.id ? { ...x, status: 'done', result, error: null } : x
      )));
    } catch (error) {
      if (error?.name === 'AbortError') {
        setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'ready', error: null } : x));
        return;
      }
      await logAnalysisError(error, auth.token);
      setItems((prev) => prev.map((x) => (
        x.id === item.id
          ? {
              ...x,
              status: 'error',
              error: error?.title
                ? error
                : {
                    title: '재분석 실패',
                    reason: error?.message || '알 수 없는 오류가 발생했습니다.',
                    solutions: ['잠시 후 다시 시도해 주세요.'],
                    code: 'CLIENT_ERROR',
                    status: ''
                  }
            }
          : x
      )));
    } finally {
      setAnalysisElapsedSeconds((prev) => prev + ((performance.now() - startedAt) / 1000));
      setBusy(false);
    }
  }

  async function runAnalysis(session, targetItems = items) {
    if (!targetItems.length || busy) return;
    const sessionAccount = session?.account;
    const sessionRemaining = Math.max(0, Number(sessionAccount?.limit_count || 0) - Number(sessionAccount?.used_count || 0));
    if (sessionRemaining < targetItems.length) {
      alert(`남은 분석 가능 횟수는 ${sessionRemaining}장입니다. 사진 수를 줄여 주세요.`);
      return;
    }
    const startedAt = performance.now();
    const selectedMode = analysisMode;
    analysisStoppedRef.current = false;
    setBusy(true);

    const queue = [...targetItems];
    let nextIndex = 0;

    async function worker() {
      while (!analysisStoppedRef.current && nextIndex < queue.length) {
        const item = queue[nextIndex];
        nextIndex += 1;
        try {
          const result = await analyzeOne(item, session.token, selectedMode);
          if (analysisStoppedRef.current) break;
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'done', result, error: null } : x));
        } catch (error) {
          if (error?.name === 'AbortError' || analysisStoppedRef.current) {
            setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'ready', error: null } : x));
            break;
          }
          await logAnalysisError(error, session.token);
          setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, status: 'error', error: error?.title ? error : { title: '분석 실패', reason: error?.message || '알 수 없는 오류가 발생했습니다.', solutions: ['잠시 후 다시 시도해 주세요.'], code: 'CLIENT_ERROR', status: '' } } : x));
        }
      }
    }

    try {
      const workerCount = Math.min(2, queue.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      setAnalysisElapsedSeconds((prev) => prev + ((performance.now() - startedAt) / 1000));
      setBusy(false);
    }
  }

  function stopAnalysis() {
    if (!busy) return;
    analysisStoppedRef.current = true;
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    setItems((previous) => previous.map((item) => (
      item.status === 'compressing' || item.status === 'analyzing' || item.status === 'retrying'
        ? { ...item, status: 'ready', error: null }
        : item
    )));
    setBusy(false);
  }

  function analyzeAll() {
    if (!normalizeStudentName(studentName)) {
      alert('분석 전에 학생 이름을 입력해 주세요.');
      return;
    }
    if (!auth) {
      setLoginMode('analyze');
      return;
    }
    runAnalysis(auth);
  }

  function reanalyzeAllErrors() {
    const errorItems = items.filter((item) => item.status === 'error');
    if (!errorItems.length || busy) return;
    if (!normalizeStudentName(studentName)) {
      alert('분석 전에 학생 이름을 입력해 주세요.');
      return;
    }
    if (!auth) {
      setLoginMode('reanalyze-errors');
      return;
    }
    runAnalysis(auth, errorItems);
  }

  async function completeLogin(data) {
    const session = { token: data.token, account: data.account };
    onLogin(session);
    const shouldAnalyze = loginMode === 'analyze';
    const shouldReanalyzeErrors = loginMode === 'reanalyze-errors';
    setLoginMode(null);
    if (shouldAnalyze) await runAnalysis(session);
    if (shouldReanalyzeErrors) await runAnalysis(session, items.filter((item) => item.status === 'error'));
  }

  function copyResult(item) {
    const problems = Array.isArray(item.result?.problems) ? item.result.problems : [];
    if (!problems.length) return;

    const lines = problems.map((problem, index) => {
      const number = String(problem?.number || index + 1).trim();
      const verdict = problem?.verdict || '확인 필요';
      const message = String(problem?.message || verdict).trim();
      const studentExpression = String(problem?.studentExpression || '').trim();
      const correctExpression = String(problem?.correctExpression || '').trim();
      const errorType = String(problem?.errorType || '').trim();
      const details = [];
      const originalVerdict = problem?.originalVerdict || verdict;
      const canShowOriginalError = !problem?.manuallyChanged || originalVerdict === '틀림';
      if (verdict === '틀림' && errorType) details.push(`오류유형: ${errorType}`);
      if (verdict === '틀림' && canShowOriginalError && studentExpression) details.push(`학생식: ${studentExpression}`);
      if (verdict === '틀림' && canShowOriginalError && correctExpression) details.push(`올바른 식: ${correctExpression}`);
      if (verdict !== '맞음' && verdict !== '틀림' && canShowOriginalError && message && message !== verdict && message !== '맞음') details.push(message);
      return details.length
        ? `${number}번: ${verdict}\n${details.join('\n')}`
        : `${number}번: ${verdict}`;
    });

    navigator.clipboard.writeText(lines.join('\n'));
  }

  const allAnalyzedProblems = items.flatMap((item) => Array.isArray(item.result?.problems) ? item.result.problems : []);
  const analyzedProblems = allAnalyzedProblems.length;
  const correctProblems = allAnalyzedProblems.filter((problem) => problem?.verdict === '맞음').length;
  const incorrectProblems = allAnalyzedProblems.filter((problem) => problem?.verdict === '틀림').length;
  const reviewProblems = allAnalyzedProblems.filter((problem) => problem?.verdict === '확인 필요').length;
  const calculationErrors = allAnalyzedProblems.filter((problem) => problem?.verdict === '틀림' && problem?.errorType === '계산오류').length;
  const conceptErrors = allAnalyzedProblems.filter((problem) => problem?.verdict === '틀림' && problem?.errorType === '개념오류').length;
  const studentSummary = {
    total: analyzedProblems,
    correct: correctProblems,
    incorrect: incorrectProblems,
    review: reviewProblems,
    calculation: calculationErrors,
    concept: conceptErrors,
    correctRate: analyzedProblems ? ((correctProblems / analyzedProblems) * 100).toFixed(1) : '0.0',
    incorrectRate: analyzedProblems ? ((incorrectProblems / analyzedProblems) * 100).toFixed(1) : '0.0'
  };

  async function saveStudentData(summary = studentSummary) {
    const name = normalizeStudentName(studentName);
    if (!auth?.token || !name || !summary.total) return false;
    setSaveState('saving');
    try {
      const response = await fetch('/.netlify/functions/student-weekly-data', {
        method: 'POST',
        headers: apiHeaders(auth.token),
        body: JSON.stringify({ recordId, studentName: name, ...summary })
      });
      if (!response.ok) throw new Error('저장 실패');
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  }

  async function loadWeeklyData() {
    const name = normalizeStudentName(studentName);
    if (!auth?.token || !name) return;
    setWeeklyLoading(true);
    try {
      const response = await fetch(`/.netlify/functions/student-weekly-data?studentName=${encodeURIComponent(name)}`, { headers: apiHeaders(auth.token) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || '주간 데이터 조회 실패');
      setWeeklyRecords(data.records || []);
    } catch {
      setWeeklyRecords([]);
    } finally {
      setWeeklyLoading(false);
    }
  }

  async function openStudentSummary() {
    await saveStudentData();
    setSummaryStudentName(normalizeStudentName(studentName));
    setShowStudentSummary(true);
    await loadWeeklyData();
  }

  async function loadAllStudentRecords() {
    if (!auth?.token) return;
    setAllRecordsLoading(true);
    try {
      const response = await fetch('/.netlify/functions/student-weekly-data?scope=all', { headers: apiHeaders(auth.token) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || '전체 학생 기록 조회 실패');
      setAllStudentRecords(data.records || []);
    } catch {
      setAllStudentRecords([]);
    } finally {
      setAllRecordsLoading(false);
    }
  }

  async function openStudentRecords() {
    if (!auth) { setLoginMode('login'); return; }
    setShowStudentRecords(true);
    await loadAllStudentRecords();
  }

  async function selectStudentRecord(name) {
    setShowStudentRecords(false);
    setSummaryStudentName(name);
    setShowStudentSummary(true);
    setWeeklyLoading(true);
    try {
      const response = await fetch(`/.netlify/functions/student-weekly-data?studentName=${encodeURIComponent(name)}`, { headers: apiHeaders(auth.token) });
      const data = await response.json().catch(() => ({}));
      setWeeklyRecords(response.ok ? (data.records || []) : []);
    } finally { setWeeklyLoading(false); }
  }

  async function deleteStudentRecord(name) {
    if (!window.confirm(`${name} 학생의 최근 3주 기록을 모두 삭제할까요?`)) return;
    const response = await fetch(`/.netlify/functions/student-weekly-data?studentName=${encodeURIComponent(name)}`, { method: 'DELETE', headers: apiHeaders(auth.token) });
    if (!response.ok) { alert('학생 기록을 삭제하지 못했습니다.'); return; }
    setAllStudentRecords((previous) => previous.filter((row) => row.student_name !== name));
    if (normalizeStudentName(summaryStudentName) === normalizeStudentName(name)) setWeeklyRecords([]);
  }

  useEffect(() => {
    if (!auth?.token || !normalizeStudentName(studentName) || !studentSummary.total) return undefined;
    const timer = window.setTimeout(() => { saveStudentData(); }, 500);
    return () => window.clearTimeout(timer);
  }, [auth?.token, recordId, studentName, studentSummary.total, studentSummary.correct, studentSummary.incorrect, studentSummary.review, studentSummary.calculation, studentSummary.concept]);

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark" aria-hidden="true">✓</div>
          <div>
            <strong>풀이체커</strong>
          </div>
        </div>

        <div className="topbarActions">
          <div className="modelModeToggle" aria-label="분석 모델 선택">
            <button type="button" className={analysisMode === 'MEDIUM' ? 'active' : ''} disabled={busy} onClick={() => setAnalysisMode('MEDIUM')}>MED</button>
            <button type="button" className={analysisMode === 'GENERAL' ? 'active' : ''} disabled={busy} onClick={() => setAnalysisMode('GENERAL')}>LOW</button>
          </div>
          <span className="analysisTimeBadge">분석시간 <b>{formatAnalysisSeconds(analysisElapsedSeconds)}</b></span>
          {auth ? (
            <>
              <span className="userEmail">{account?.login_id}</span>
              <TopbarQuota account={account} />
            </>
          ) : null}
          <a className="topbarTrialButton" href={KAKAO_LINK} target="_blank" rel="noreferrer noopener">무료체험 신청</a>
        </div>
      </header>

      <div className="appContent">
        <section className="quickStartGrid" aria-label="빠른 시작">
          <article className="heroMiniCard">
            <div className="heroMiniCopy">
              <h1>학생 풀이<br /><em>틀린 곳만 빠르게</em></h1>
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
            <p className="miniUploadHint">최대 50장</p>
          </article>
        </section>

        <section className="studentNameEntry" aria-label="학생 이름 입력">
          <label>
            <span>학생 이름</span>
            <input value={studentName} onChange={(event) => setStudentName(event.target.value.slice(0, 30))} placeholder="이름을 입력하면 분석 결과가 자동 저장됩니다" />
          </label>
          <small>{saveState === 'saving' ? '저장 중...' : saveState === 'saved' ? '자동 저장됨' : saveState === 'error' ? '저장 실패 · 잠시 후 다시 시도됩니다' : '분석 전에 학생 이름을 입력해 주세요.'}</small>
          <div className="studentNameActions">
            <button type="button" className="allStudentRecordsButton" onClick={openStudentRecords}>전체 학생 기록</button>
            <button type="button" className="allStudentRecordsButton" onClick={() => auth ? setShowStudentAccess(true) : setLoginMode('login')}>학생 접속 관리</button>
          </div>
        </section>

        {analyzedProblems > 0 ? (
          <section className="analysisCounter resultOverview" aria-live="polite">
            <div className="resultOverviewText">
              <strong>분석 결과</strong>
              <span>
                총 <b>{analyzedProblems.toLocaleString()}</b>문제 중
                틀림 <em>{incorrectProblems.toLocaleString()}</em>문제 ·
                확인 필요 <i>{reviewProblems.toLocaleString()}</i>문제
              </span>
            </div>
            {normalizeStudentName(studentName) ? (
              <button type="button" className="studentDetailButton" onClick={openStudentSummary}>상세보기</button>
            ) : null}
            <button
              type="button"
              className={`hideCorrectButton ${hideCorrect ? 'active' : ''}`}
              onClick={() => setHideCorrect((prev) => !prev)}
            >
              {hideCorrect ? '맞음 포함하기' : '맞음 제외하기'}
            </button>
          </section>
        ) : null}

        <div className="actions compactActions">
          <button className="primary" disabled={!canAnalyze} onClick={analyzeAll}>
            <svg className="actionIcon sparkleIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.8 13.4 8l4.8 1.5-4.8 1.5L12 16.2 10.6 11 5.8 9.5 10.6 8 12 2.8Z" />
              <path d="m18.5 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z" />
            </svg>
            <span>{busy ? '분석 중...' : '전체 분석'}</span>
            <span className="actionArrow" aria-hidden="true">›</span>
          </button>
          <button className="stopAnalysisButton" disabled={!busy} onClick={stopAnalysis}>
            <span className="stopSquare" aria-hidden="true" />
            <span>분석 중단</span>
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
          <button className="reanalyzeAllErrorsButton" disabled={busy || !items.some((item) => item.status === 'error')} onClick={reanalyzeAllErrors}>
            <span>오류 전체 재분석</span>
          </button>
        </div>

        {auth && remaining < items.length && items.length > 0 ? (
          <div className="quotaWarning">남은 분석 가능 횟수는 {remaining}장입니다. 사진 수를 줄여 주세요.</div>
        ) : null}

        <section className="grid">
          {items.map((item, idx) => {
            const itemProblems = Array.isArray(item.result?.problems) ? item.result.problems : [];
            const hideWholeCard = hideCorrect
              && itemProblems.length > 0
              && itemProblems.every((problem) => problem?.verdict === '맞음');
            if (hideWholeCard) return null;

            return (
            <article className="card" key={item.id}>
              <div
                className={`thumbWrap ${item.status === 'done' ? 'zoomable' : ''}`}
                onClick={() => item.status === 'done' && setLightboxItem(item)}
                onKeyDown={(event) => {
                  if (item.status === 'done' && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    setLightboxItem(item);
                  }
                }}
                role={item.status === 'done' ? 'button' : undefined}
                tabIndex={item.status === 'done' ? 0 : undefined}
                aria-label={item.status === 'done' ? `${item.name} 크게 보기` : undefined}
              >
                <img src={item.preview} alt={item.name} />
                <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
                {item.status === 'done' ? <span className="zoomHint" aria-hidden="true">⌕ 눌러서 확대</span> : null}
              </div>
              <div className="cardBody">
                <div className="row between">
                  <div>
                    <button type="button" className="splitPhotoButton" disabled={busy} onClick={() => setSplitTarget(item)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16"/><path d="m8 9 4 3-4 3M16 9l-4 3 4 3"/></svg>
                      <span>사진 나누기</span>
                    </button>
                    <strong>학생 풀이 {idx + 1}</strong>
                  </div>
                  <div className="cardTools">
                    {(item.result || item.status === 'error' || item.splitFromError) ? (
                      <button className="reanalyzeLinkBtn" disabled={busy} onClick={() => reanalyzeItem(item)}>
                        {item.status === 'compressing' || item.status === 'analyzing' || item.status === 'retrying' ? '재분석 중...' : '재분석'}
                      </button>
                    ) : null}
                    <button className="cropLinkBtn" disabled={busy} onClick={() => openEditor(item.id)}>편집</button>
                    <button className="linkBtn" disabled={busy} onClick={() => removeItem(item.id)}>삭제</button>
                  </div>
                </div>
                <p className="meta">{item.name} · {formatBytes(item.size)}{item.edited ? ' · 편집 적용됨' : ''}</p>
                {item.status === 'ready' && <p className="muted">분석할 준비가 됐어요.</p>}
                {item.status === 'compressing' && <p className="muted loadingText">이미지 전송 준비 중...</p>}
                {item.status === 'analyzing' && <p className="muted loadingText">{analysisStageText(item.analysisStage)}</p>}
                {item.status === 'retrying' && <p className="muted loadingText">일시 오류로 5초 후 자동 재시도 중입니다...</p>}
                {item.status === 'error' && <AnalysisErrorCard error={item.error} />}
                {item.result && <ResultCard
                  item={item}
                  hideCorrect={hideCorrect}
                  onCopy={() => copyResult(item)}
                  onChangeVerdict={(problemIndex, current, currentErrorType) => openVerdictDialog(item.id, problemIndex, current, currentErrorType)}
                />}
              </div>
            </article>
            );
          })}
        </section>

        {!items.length && (
          <section className="emptyState">
            <div className="emptyIcon" aria-hidden="true">⌁</div>
            <strong>아직 올린 사진이 없어요</strong>
            <p>위의 사진 업로드 버튼을 눌러 풀이 사진을 추가하세요.</p>
          </section>
        )}


        {editTargetId ? (
          <CropModal
            item={items.find((item) => item.id === editTargetId)}
            onClose={closeEditor}
            onApply={applyEdit}
          />
        ) : null}

        {splitTarget ? <SplitModal item={splitTarget} onApply={applySplitItem} onClose={() => setSplitTarget(null)} /> : null}

        {verdictTarget ? (
          <VerdictDialog
            current={verdictTarget.current}
            currentErrorType={verdictTarget.currentErrorType}
            onSave={changeVerdict}
            onClose={() => setVerdictTarget(null)}
          />
        ) : null}

        {showStudentSummary ? (
          <StudentSummaryDialog
            studentName={summaryStudentName}
            summary={studentSummary}
            weeklyRecords={weeklyRecords}
            weeklyLoading={weeklyLoading}
            onClose={() => setShowStudentSummary(false)}
          />
        ) : null}

        {showStudentRecords ? <StudentRecordsDialog records={allStudentRecords} loading={allRecordsLoading} onSelect={selectStudentRecord} onDelete={deleteStudentRecord} onClose={() => setShowStudentRecords(false)} /> : null}
        {showStudentAccess && auth ? <StudentAccessManager token={auth.token} onClose={() => setShowStudentAccess(false)} /> : null}

        {lightboxItem ? (
          <ImageLightbox
            src={lightboxItem.preview}
            alt={lightboxItem.name}
            onClose={() => setLightboxItem(null)}
          />
        ) : null}

        {loginMode ? (
          <LoginScreen
            modal
            onClose={() => setLoginMode(null)}
            onLogin={completeLogin}
            submitLabel={loginMode === 'analyze' ? '로그인하고 분석하기' : '로그인'}
          />
        ) : null}

        <footer className="footerNote">
          <div className="footerSupportButtons">
            {auth ? (
              <button type="button" className="footerAuthButton" onClick={onLogout}>로그아웃</button>
            ) : (
              <button type="button" className="footerAuthButton" onClick={() => setLoginMode('login')}>로그인</button>
            )}
            <a className="supportButton" href={KAKAO_LINK} target="_blank" rel="noreferrer noopener">고객센터</a>
          </div>
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
  const [usage, setUsage] = useState([]);
  const [analysisErrors, setAnalysisErrors] = useState([]);
  const [form, setForm] = useState({ loginId:'', password:'', limitCount:100 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await apiRequest('admin-api', { token });
      setAccounts(data.accounts || []);
      setUsage(data.usage || []);
      setAnalysisErrors(data.analysisErrors || []);
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
      if (data.usage) setUsage(data.usage);
      if (data.analysisErrors) setAnalysisErrors(data.analysisErrors);
    } catch(e){ setError(e.message); }
  }

  const totalInputTokens = usage.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0);
  const totalAnswerTokens = usage.reduce((sum, row) => sum + Number(row.answer_tokens || 0), 0);
  const totalThinkingTokens = usage.reduce((sum, row) => sum + Number(row.thinking_tokens || 0), 0);
  const totalEstimatedCost = usage.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
  const accountNameById = Object.fromEntries(accounts.map((account) => [account.id, account.login_id]));
  const errorStatusCounts = analysisErrors.reduce((counts, row) => {
    const key = String(row.http_status || 500);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const errorTypeCounts = analysisErrors.reduce((counts, row) => {
    const key = String(row.error_code || row.error_type || 'UNKNOWN_ERROR');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  function modelUsage(accountId, models) {
    const modelList = Array.isArray(models) ? models : [models];
    return usage.filter((row) => row.account_id === accountId && modelList.includes(row.model)).reduce((sum, row) => ({
      input: sum.input + Number(row.input_tokens || 0),
      answer: sum.answer + Number(row.answer_tokens || 0),
      thinking: sum.thinking + Number(row.thinking_tokens || 0),
      total: sum.total + Number(row.total_tokens || 0),
      cost: sum.cost + Number(row.estimated_cost_usd || 0)
    }), { input:0, answer:0, thinking:0, total:0, cost:0 });
  }

  const modeModels = {
    HIGH: ['gemini-3.6-flash-high', 'gemini-3.6-flash-pro', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-3.6-flash-light', 'gemini-3.5-flash', 'gemini-3.6-flash'],
    MED: ['gemini-3.6-flash-medium', 'gemini-3.6-flash-middle'],
    LOW: ['gemini-3.6-flash-low']
  };
  const tokenRanges = [
    { label: '0–999', min: 0, max: 1000 },
    ...Array.from({ length: 9 }, (_, index) => ({
      label: `${((index + 1) * 1000).toLocaleString()}–${(((index + 2) * 1000) - 1).toLocaleString()}`,
      min: (index + 1) * 1000,
      max: (index + 2) * 1000
    })),
    { label: '10,000 이상', min: 10000, max: Infinity }
  ];
  const usageByMode = Object.fromEntries(Object.entries(modeModels).map(([mode, models]) => [
    mode,
    usage.filter((row) => models.includes(row.model))
  ]));
  function rangeUsageCount(mode, range) {
    return (usageByMode[mode] || []).filter((row) => {
      const outputTokens = Math.max(0, Number(row.output_tokens || 0));
      return outputTokens >= range.min && outputTokens < range.max;
    }).length;
  }
  function formatRangeCount(mode, range) {
    const count = rangeUsageCount(mode, range);
    const total = (usageByMode[mode] || []).length;
    const percent = total ? (count / total) * 100 : 0;
    return `${count.toLocaleString()}건 · ${percent.toFixed(1)}%`;
  }

  async function downloadExcel() {
    const XLSX = await import('xlsx');
    const summary = accounts.map((account) => {
      const advanced = modelUsage(account.id, ['gemini-3.6-flash-high', 'gemini-3.6-flash-pro', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-3.6-flash-light', 'gemini-3.5-flash', 'gemini-3.6-flash']);
      const general = modelUsage(account.id, ['gemini-3.6-flash-low']);
      const middle = modelUsage(account.id, ['gemini-3.6-flash-medium', 'gemini-3.6-flash-middle']);
      return {
        아이디: account.login_id, 총한도: account.limit_count, 사용: account.used_count,
        남음: Math.max(0, account.limit_count - account.used_count), 상태: account.active ? '사용중' : '중지',
        'HIGH 입력토큰(과거)': advanced.input, 'HIGH 일반출력(과거)': advanced.answer, 'HIGH 추론(과거)': advanced.thinking, 'HIGH 총토큰(과거)': advanced.total, 'HIGH 비용(USD·과거)': advanced.cost,
        'MED 입력토큰': middle.input, 'MED 일반출력': middle.answer, 'MED 추론': middle.thinking, 'MED 총토큰': middle.total, 'MED 비용(USD)': middle.cost,
        'LOW 입력토큰': general.input, 'LOW 일반출력': general.answer, 'LOW 추론': general.thinking, 'LOW 총토큰': general.total, 'LOW 비용(USD)': general.cost,
        '총비용(USD)': advanced.cost + general.cost + middle.cost, 생성일: account.created_at
      };
    });
    const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account.login_id]));
    const details = usage.map((row) => ({
      분석일시: row.created_at, 아이디: accountMap[row.account_id] || row.account_id, 모델: row.model,
      구분: '분석', 입력토큰: row.input_tokens,
      일반출력토큰: row.answer_tokens, 추론토큰: row.thinking_tokens, 전체출력토큰: row.output_tokens,
      총토큰: row.total_tokens, '비용(USD)': Number(row.estimated_cost_usd || 0)
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), '계정 요약');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(details), '분석 사용내역');
    XLSX.writeFile(workbook, `풀이체커_사용량_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return <main className="adminPage">
    <header className="adminTop"><div><strong>풀이체커 관리자</strong><span>계정·분석 장수 관리</span></div><div><button onClick={downloadExcel}>엑셀 내려받기</button><a href="/">사용자 화면</a><button onClick={onLogout}>로그아웃</button></div></header>
    <div className="adminContent">
      <section className="adminUsageSummary" aria-label="전체 API 사용 현황">
        <div><span>전체 입력토큰</span><b>{formatCompactCount(totalInputTokens)}</b></div>
        <div><span>전체 일반출력</span><b>{formatCompactCount(totalAnswerTokens)}</b></div>
        <div><span>전체 추론토큰</span><b>{formatCompactCount(totalThinkingTokens)}</b></div>
        <div><span>누적 예상비용</span><b>{formatUsd(totalEstimatedCost)} USD</b></div>
        <p>HIGH(과거)·MED·LOW 실제 사용량 기준</p>
      </section>
      <section className="adminErrorPanel" aria-label="출력 및 추론 토큰 구간 통계">
        <div className="adminErrorHeading">
          <div><h2>출력+추론 토큰 구간 통계</h2><p>분석 1건당 실제 output_tokens 기준 · 건수와 모드 내 비율</p></div>
          <strong>총 {usage.length.toLocaleString()}건</strong>
        </div>
        <div className="adminErrorTableWrap">
          <table className="adminErrorTable"><thead><tr><th>토큰 구간</th><th>HIGH(과거)</th><th>MED</th><th>LOW</th></tr></thead><tbody>
            {tokenRanges.map((range) => <tr key={range.label}>
              <td><b>{range.label}</b></td>
              <td>{formatRangeCount('HIGH', range)}</td>
              <td>{formatRangeCount('MED', range)}</td>
              <td>{formatRangeCount('LOW', range)}</td>
            </tr>)}
          </tbody></table>
        </div>
      </section>
      <section className="adminErrorPanel" aria-label="분석 오류 현황">
        <div className="adminErrorHeading">
          <div><h2>분석 오류 현황</h2><p>사진·학생식·풀이 내용은 저장하지 않습니다.</p></div>
          <strong>총 {analysisErrors.length.toLocaleString()}회</strong>
        </div>
        <div className="adminErrorChips">
          {Object.entries(errorStatusCounts).sort().map(([status, count]) => <span key={status}>HTTP {status} · {count}회</span>)}
          {Object.entries(errorTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => <span key={type}>{type} · {count}회</span>)}
        </div>
        <div className="adminErrorTableWrap">
          <table className="adminErrorTable"><thead><tr><th>발생 시각</th><th>계정</th><th>오류번호</th><th>오류 코드</th><th>출처</th><th>소요시간</th><th>응답 형식</th><th>종류·응답</th></tr></thead><tbody>
            {analysisErrors.slice(0, 200).map((row) => <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString('ko-KR')}</td>
              <td>{accountNameById[row.account_id] || '삭제된 계정'}</td>
              <td>{row.http_status || 500}</td>
              <td>{row.error_code || 'UNKNOWN_ERROR'}</td>
              <td>{row.error_source || 'UNKNOWN'}</td>
              <td>{row.elapsed_ms ? `${(Number(row.elapsed_ms) / 1000).toFixed(1)}초` : '-'}</td>
              <td title={row.request_id ? `요청 ID: ${row.request_id}` : ''}>{row.response_content_type || '-'}</td>
              <td title={row.response_body || ''}>{row.error_type || '분석 실패'}{row.response_body ? ' · 응답 내용 확인' : ''}</td>
            </tr>)}
            {!analysisErrors.length ? <tr><td colSpan="8">기록된 오류가 없습니다.</td></tr> : null}
          </tbody></table>
        </div>
      </section>
      <section className="adminCreate"><h2>새 계정 만들기</h2><div className="adminFormRow"><input placeholder="아이디" value={form.loginId} onChange={(e)=>setForm({...form,loginId:e.target.value})}/><input placeholder="비밀번호" type="password" value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})}/><input type="number" min="0" value={form.limitCount} onChange={(e)=>setForm({...form,limitCount:e.target.value})}/><button onClick={()=>action('create',{...form,limitCount:Number(form.limitCount)})}>계정 생성</button></div></section>
      {error?<div className="authAlert error">{error}</div>:null}{message?<div className="authAlert success">{message}</div>:null}
      <section className="adminTableWrap"><table className="adminTable"><thead><tr><th>아이디</th><th>총 한도</th><th>사용</th><th>남음</th><th>HIGH 토큰·비용(과거)</th><th>MED 토큰·비용</th><th>LOW 토큰·비용</th><th>총비용(USD)</th><th>상태</th><th>관리</th></tr></thead><tbody>
        {accounts.map(a=>{
          const advanced = modelUsage(a.id, ['gemini-3.6-flash-high', 'gemini-3.6-flash-pro', 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-3.6-flash-light', 'gemini-3.5-flash', 'gemini-3.6-flash']);
          const general = modelUsage(a.id, ['gemini-3.6-flash-low']);
          const middle = modelUsage(a.id, ['gemini-3.6-flash-medium', 'gemini-3.6-flash-middle']);
          return <tr key={a.id}><td><b>{a.login_id}</b></td><td>{a.limit_count}</td><td>{a.used_count}</td><td>{Math.max(0,a.limit_count-a.used_count)}</td><td title={`입력 ${advanced.input.toLocaleString()} / 일반출력 ${advanced.answer.toLocaleString()} / 추론 ${advanced.thinking.toLocaleString()}`}><span>입 {formatCompactCount(advanced.input)} · 출 {formatCompactCount(advanced.answer)} · 추 {formatCompactCount(advanced.thinking)}</span><br/><b>총 {formatCompactCount(advanced.total)} · {formatUsd(advanced.cost)}</b></td><td title={`입력 ${middle.input.toLocaleString()} / 일반출력 ${middle.answer.toLocaleString()} / 추론 ${middle.thinking.toLocaleString()}`}><span>입 {formatCompactCount(middle.input)} · 출 {formatCompactCount(middle.answer)} · 추 {formatCompactCount(middle.thinking)}</span><br/><b>총 {formatCompactCount(middle.total)} · {formatUsd(middle.cost)}</b></td><td title={`입력 ${general.input.toLocaleString()} / 일반출력 ${general.answer.toLocaleString()} / 추론 ${general.thinking.toLocaleString()}`}><span>입 {formatCompactCount(general.input)} · 출 {formatCompactCount(general.answer)} · 추 {formatCompactCount(general.thinking)}</span><br/><b>총 {formatCompactCount(general.total)} · {formatUsd(general.cost)}</b></td><td><b>{formatUsd(advanced.cost + general.cost + middle.cost)}</b></td><td>{a.active?'사용중':'중지'}</td><td><div className="adminButtons">
          <button onClick={()=>action('add_limit',{accountId:a.id,amount:10})}>+10</button><button onClick={()=>action('add_limit',{accountId:a.id,amount:50})}>+50</button><button onClick={()=>action('add_limit',{accountId:a.id,amount:100})}>+100</button>
          <button onClick={()=>{const amount=Number(prompt('추가할 장수를 입력하세요.','500')); if(amount>0) action('add_limit',{accountId:a.id,amount});}}>직접 추가</button>
          <button onClick={()=>{const n=Number(prompt('총 분석 가능 장수를 입력하세요.',String(a.limit_count))); if(n>=0) action('set_limit',{accountId:a.id,limitCount:n});}}>한도 변경</button>
          <button onClick={()=>{if(confirm(`${a.login_id}의 사용 장수·토큰·비용을 모두 초기화할까요? 총 한도는 유지됩니다.`)) action('reset_all',{accountId:a.id});}}>전체 초기화</button>
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
  const isStudent = window.location.pathname.startsWith('/student');
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState(null);
  const [adminToken, setAdminToken] = useState(localStorage.getItem('math_checker_admin_token') || '');

  React.useEffect(() => {
    if (isAdmin || isStudent) { setLoading(false); return; }
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
  if (isStudent) return <StudentApp />;
  if (loading) return <main className="authPage"><div className="authLoading">로그인 상태를 확인하고 있어요...</div></main>;
  return <CheckerApp
    auth={auth}
    onLogin={(session) => setAuth(session)}
    onLogout={logout}
    onAccountUpdate={(account) => setAuth((previous) => {
      if (!previous) return previous;
      const current = previous.account || {};
      return {
        ...previous,
        account: {
          ...current,
          ...account,
          used_count: Math.max(Number(current.used_count || 0), Number(account?.used_count || 0)),
          total_input_tokens: Math.max(Number(current.total_input_tokens || 0), Number(account?.total_input_tokens || 0)),
          total_output_tokens: Math.max(Number(current.total_output_tokens || 0), Number(account?.total_output_tokens || 0)),
          total_tokens: Math.max(Number(current.total_tokens || 0), Number(account?.total_tokens || 0))
        }
      };
    })}
  />;
}

createRoot(document.getElementById('root')).render(<RootApp />);
