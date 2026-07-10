# 풀이체커 Day3 누적 버전

## 포함 기능
- Day1: React + Vite 기반, 사진 여러 장 업로드/미리보기, 모바일 UI
- Day2: Netlify Functions + OpenAI Vision API 연결
- Day3: 계산 실수/논리 비약 결과 구조화, 선생님 확인 필요 항목만 강조, 이미지 전송 전 자동 리사이즈

## GitHub 업로드
압축을 푼 뒤 아래 전체를 GitHub 저장소 루트에 업로드하세요.

- index.html
- package.json
- netlify.toml
- README.md
- src 폴더 전체
- netlify 폴더 전체

기존 루트에 남아 있는 `main.jsx`, `styles.css`, `analyze.js`는 삭제하세요. 정상 구조에서는 이 파일들이 각각 `src/`와 `netlify/functions/` 안에 있어야 합니다.

## Netlify 설정
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

## Environment variables
- OPENAI_API_KEY = 본인 OpenAI API 키
- OPENAI_MODEL = gpt-5.5

## 주의
API 키는 GitHub나 HTML 파일에 넣지 말고 Netlify 환경변수에만 저장하세요.
