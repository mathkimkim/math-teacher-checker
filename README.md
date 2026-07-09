# 풀이체커 Day 2 누적 버전

Day 1 기능(React UI, 사진 여러 장 업로드, 미리보기)에 Day 2 기능(Netlify Function + OpenAI 분석)을 누적한 버전입니다.

## GitHub 업로드
압축을 풀고 아래 파일/폴더 전체를 기존 저장소에 올리세요.

- index.html
- package.json
- netlify.toml
- src 폴더
- netlify 폴더
- README.md

## Netlify 설정
Build command

```bash
npm run build
```

Publish directory

```bash
dist
```

Functions directory

```bash
netlify/functions
```

## 환경변수

- OPENAI_API_KEY = OpenAI API 키
- OPENAI_MODEL = gpt-5.5

