# 풀이체커 V1 - Netlify 배포용

## 구성
- `index.html` : 웹 화면
- `netlify/functions/analyze.js` : OpenAI API 호출 서버 함수
- `netlify.toml` : Netlify 설정
- `package.json` : Netlify Functions 의존성

## GitHub 업로드
압축을 푼 뒤 아래 5개를 모두 업로드하세요.

- index.html
- netlify.toml
- package.json
- README.md
- netlify 폴더 전체

## Netlify 환경변수
Netlify 사이트 설정에서 아래 2개를 추가하세요.

- OPENAI_API_KEY = 본인 API 키
- OPENAI_MODEL = gpt-5.5

## 중요
Netlify Drop이 아니라 GitHub 연결 배포로 사용하세요.
