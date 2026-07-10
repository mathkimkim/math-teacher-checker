# 풀이체커 Teacher — 최종 안정화 버전

React/Vite/npm 빌드를 제거한 **순수 HTML + Netlify Function** 버전입니다.
GitHub에 업로드하면 패키지 설치 없이 배포되므로 빌드가 훨씬 빠르고 오류 지점이 적습니다.

## 파일 구조

```text
index.html
netlify.toml
netlify/functions/analyze.mjs
```

## GitHub 업로드

기존 저장소 파일을 모두 지운 뒤, 이 폴더 안의 3개 항목을 그대로 업로드하는 것을 권장합니다.

- `index.html`
- `netlify.toml`
- `netlify` 폴더 전체

이전 버전의 `src`, `package.json`, `package-lock.json`, 루트의 `main.jsx`, `styles.css`, `analyze.js`는 삭제하세요.

## Netlify 설정

`netlify.toml`이 자동으로 다음을 적용합니다.

- Build command: 없음
- Publish directory: `.`
- Functions directory: `netlify/functions`

환경변수는 기존 값을 그대로 사용합니다.

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

속도를 우선하면 `OPENAI_MODEL=gpt-5-mini`를 권장합니다. 정확도를 우선해 다른 이미지 입력 가능 모델을 쓰려면 환경변수만 변경하세요.

## 포함 기능

- 사진 최대 6장
- 브라우저에서 이미지 자동 축소
- 사진별 순차 분석
- 계산 실수 표시
- 빨간색급 논리 비약만 표시
- API 키, 크레딧, 사용량 제한, 이미지 용량, 서버 오류, 시간 초과별 원인 안내
- 다시 분석 버튼


## 업데이트
- 풀이 사진 터치 시 전체 화면 확대 보기
- 논리 비약 결과에서 “필요 과정” 숨김
