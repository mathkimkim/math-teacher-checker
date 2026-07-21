# 풀이체커 Day3 누적 버전

## Windows 로컬 실행
1. ZIP 압축을 완전히 풉니다.
2. `SUPER_LOCAL.bat`을 더블클릭합니다.
3. 최초 실행 때 열리는 `.env`에서 `CHANGE_ME` 값을 실제 API 정보로 바꾸고 저장합니다.
4. BAT를 다시 실행하면 필요한 패키지를 자동 설치하고 풀이체커를 시작합니다.
5. 사용자 화면은 `http://localhost:8888`, 관리자 화면은 `http://localhost:8888/admin`입니다.

## 포함 기능
- Day1: React + Vite 기반, 사진 여러 장 업로드/미리보기, 모바일 UI
- Day2: Netlify Functions + Gemini 이미지 분석 API 연결
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
- GEMINI_API_KEY = 본인 Gemini API 키
- 분석 모델은 서버에서 Gemini 3.1 Pro Preview로 고정됩니다.

## 주의
API 키는 GitHub나 HTML 파일에 넣지 말고 Netlify 환경변수에만 저장하세요.

## 통합 적용 기능

- 기존 사용자 로그인, 관리자 계정 관리, 분석 장수 한도 및 Supabase/Netlify Functions 구조 유지
- 최신 상단 미니카드 인터페이스 적용
- MathJax 수식 표시 및 깨진 LaTeX 자동 복구 적용
- 틀린 식과 이유를 분리하여 표시
- 사진 편집(확대·축소·회전·초기화·자르기 영역·지우개) 적용
- 분석 완료 문제 수와 틀린 문제 수 표시
- Gemini 3.1 Pro Preview 전용 분석 및 최대 출력 2,000토큰 적용



## 아이디별 누적토큰 표시
- 상단에 `사용 1,200 / 한도 2,000 / 누적토큰 12K` 형식으로 표시합니다.
- 새 사진 분석에서 발생한 실제 Gemini API 총 토큰을 로그인 아이디별로 누적합니다.
- 기존 Supabase 사용자는 배포 전에 최신 `SUPABASE_SETUP.sql`을 SQL Editor에서 한 번 실행해야 합니다.
- 과거 토큰 기록은 복원되지 않으며, 이 버전 배포 이후 사용량부터 누적됩니다.


## 입력·출력 토큰 누적
- `accounts.total_input_tokens`: 아이디별 누적 입력 토큰
- `accounts.total_output_tokens`: 아이디별 누적 출력 토큰
- `accounts.total_tokens`: 아이디별 전체 누적 토큰
- 일반 분석의 실제 Gemini API usageMetadata 값이 누적됩니다.
- 기존 사용자도 배포 전에 `SUPABASE_SETUP.sql`을 SQL Editor에서 다시 실행해야 합니다.
- 이전에 이미 누적된 전체 토큰은 입력/출력으로 소급 분리할 수 없으며, 새 필드는 배포 이후부터 누적됩니다.


## 관리자 토큰·비용 표시
- 일반 사용자 화면에는 사용 장수와 한도만 표시됩니다.
- 입력토큰, 출력토큰, 누적토큰, 누적 예상비용(USD)은 `/admin`에서만 확인합니다.
- 비용 계산은 Gemini 3.1 Pro Preview 요금 기준입니다.
- 비용은 저장된 토큰에서 계산하는 예상액이며, 캐시 할인·지역 처리 할증 등은 포함하지 않습니다.
