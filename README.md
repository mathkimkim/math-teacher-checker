# 풀이체커 V2 배포 안정 버전

## 포함 기능
- React + Vite
- 여러 장 이미지 업로드/미리보기
- Netlify Functions
- OpenAI Vision API 연결
- 계산 실수 / 논리 비약만 출력

## GitHub 업로드
압축을 푼 뒤 아래 전체를 GitHub 저장소 루트에 업로드하세요.

- index.html
- package.json
- netlify.toml
- README.md
- src 폴더 전체
- netlify 폴더 전체

## Netlify 설정
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

## Environment variables
- OPENAI_API_KEY = 본인 OpenAI API 키
- OPENAI_MODEL = gpt-5.5

## 주의
API 키는 GitHub나 HTML 파일에 넣지 말고 Netlify 환경변수에만 저장하세요.
