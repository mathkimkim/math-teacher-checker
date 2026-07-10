# 풀이체커 Day4 최종 누적 버전

## 포함 기능
- 사진 최대 6장 업로드 및 모바일 미리보기
- 업로드 전 이미지 자동 축소
- Netlify Function에서 OpenAI Vision 분석
- 계산 실수와 빨간색급 논리 비약만 표시
- 정상 풀이면 짧게 표시
- 오류 종류별 원인 및 해결 방법 표시
- 개별 사진 다시 분석 버튼
- 분석 진행 상태 표시

## Netlify 환경변수
- `OPENAI_API_KEY`: OpenAI API 키
- `OPENAI_MODEL`: `gpt-5.5`

## 배포
압축을 풀고 아래 항목 전체를 GitHub 저장소 루트에 덮어쓰기 업로드하세요.
- `index.html`
- `package.json`
- `package-lock.json`
- `netlify.toml`
- `README.md`
- `src` 폴더
- `netlify` 폴더

Netlify 설정은 `netlify.toml`에 포함되어 있습니다.
