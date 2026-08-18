# Ratatouille

회의 녹음부터 AI 문서화까지 — **1인용 로컬 회의 워크스페이스**.

회의를 녹음하거나 음성 파일을 업로드하면, 로컬에서 전사(STT)하고, 사용자가 교정·확정한 뒤, AI가 회의 요약·결정 사항·Action Item·원문 근거 4개 결과를 생성합니다. 모든 결과는 사용자의 검수를 거쳐야만 확정되며, 데이터는 전부 내 머신의 파일로 남습니다.

```text
회의 녹음(마이크 / 마이크+탭 오디오) 또는 파일 업로드
  → chunk 업로드 + manifest 검증 → ready
  → whisper.cpp 전사 (한국어, timestamp 포함 JSON)
  → 사용자 교정 → 전사 확정 (transcript_approved)
  → AI 문서화: 요약 · 결정 사항 · Action Item · 원문 근거
  → section별 독립 검수 → 문서 확정 (current)
  → vault/ (Markdown + YAML)에 정식 원본으로 저장
```

## 설계 원칙

- **소유권 경계** — Ratatouille은 source 수명주기·계약 검증·전사 job·검수 상태를 소유합니다. 전사 엔진은 `whisper.cpp`(직접 호출), 모델 경계(provider·OAuth)는 [Hermes](https://github.com/mnfst/hermes) CLI가 소유합니다. Ratatouille은 API key나 OAuth 토큰을 직접 다루지 않습니다.
- **5개의 분리된 상태 머신** — 수집(source), 업로드 상태(upload_health), 전사 job, 전사 교정(revision), 문서화(run/document)를 하나로 합치지 않고 각각 독립적으로 전이합니다. 정의는 전부 [`packages/contracts`](packages/contracts)에 있습니다.
- **evidence 무결성** — AI가 인용한 segment ID는 반드시 실제 전사 세그먼트의 부분집합이어야 하며, 서버가 이를 강제 검증합니다. `[seg_NN]` 인용 마커 형식은 contracts 한 곳에서만 정의됩니다.
- **AI 단독 확정 불가** — 4개 결과 section은 각각 독립된 검수 상태를 갖고, 검수 계약을 충족하기 전에는 문서가 `current`가 되지 않습니다.
- **파일이 원본** — `vault/`의 Markdown + YAML이 정식 원본이고, SQLite 인덱스는 언제든 재생성 가능한 파생물입니다. 삭제는 소거가 아니라 trash 이동입니다.
- **로컬 우선** — 서버는 기본적으로 `127.0.0.1`에만 바인딩합니다. 인증·TLS·외부 공개는 범위 밖입니다.

## 저장소 구조

pnpm workspace 모노레포입니다.

| 경로 | 패키지 | 역할 |
| --- | --- | --- |
| `apps/server` | `@ratatouille/server` | 로컬 데몬. Hono + better-sqlite3. chunk 수집, whisper 전사 큐, 교정/검수 API, Hermes 문서화 큐, vault 저장·감시, 오디오 재생 캐시 |
| `apps/web` | `@ratatouille/web` | Vite SPA. React 19 + TanStack Router/Query + Tailwind 4. 녹음(`/meetings/new`), 업로드(`/upload`), 홈/Inbox(`/`), 전사 교정·문서 검수·오디오 재생(`/meetings/$meetingId`) |
| `packages/contracts` | `@ratatouille/contracts` | web/server가 공유하는 정식 계약 원본(런타임 의존성 0). 상태 머신, 선행 조건 규칙, evidence/인용 계약, 녹음 manifest, 검수·편집·결정 계약 |
| `.experiments` | — | Phase 0 실측 기록(전사 성능, 브라우저 수집 한계)과 재현 스크립트. [`RESULTS.md`](.experiments/RESULTS.md), [`BROWSER-RESULTS.md`](.experiments/BROWSER-RESULTS.md) |

## 요구사항

- **Node.js ≥ 22** — 서버는 빌드 없이 `--experimental-transform-types`로 TypeScript를 직접 실행합니다
- **pnpm 10**
- **macOS 권장** — whisper.cpp Metal 가속 기준으로 실측·튜닝됨
- 외부 도구 (npm 아님):
  - [`whisper-cpp`](https://github.com/ggml-org/whisper.cpp) — 전사 엔진 (`brew install whisper-cpp`) + 모델 `ggml-large-v3-turbo.bin`
  - `ffmpeg` — chunk 결합과 재생 오디오 변환 (`brew install ffmpeg`)
  - `hermes` CLI — AI 문서화 (선택. 없으면 수집·전사·교정까지만 동작)

> 전사·문서화 도구 없이도 서버는 뜨고 수집/조회는 동작합니다. 해당 기능을 호출하는 시점에만 실패합니다.

## 시작하기

```bash
pnpm install

# 데이터 폴더 준비 (서버는 없는 폴더를 만들어주지 않고 기동을 거부합니다)
mkdir -p .data/models

# whisper 모델 배치 (또는 RATATOUILLE_WHISPER_MODEL로 경로 지정)
# https://huggingface.co/ggerganov/whisper.cpp 에서 ggml-large-v3-turbo.bin 다운로드
mv ~/Downloads/ggml-large-v3-turbo.bin .data/models/

# 웹 테스트용 브라우저 설치 (최초 1회)
pnpm --filter @ratatouille/web test:browser:install

# 서버(:5174) + 웹(:5173) 동시 기동
pnpm dev
```

브라우저에서 `http://localhost:5173`을 열면 됩니다. 웹 dev 서버가 `/api`를 서버로 프록시합니다. 녹음의 탭 오디오 공유는 Chrome이 필요합니다.

### 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` / `HOST` | `5174` / `127.0.0.1` | 서버 바인딩 |
| `RATATOUILLE_DATA_ROOT` | `<repo>/.data` | 데이터 루트. 존재하지 않으면 기동 거부 |
| `RATATOUILLE_WHISPER_MODEL` | `.data/models/ggml-large-v3-turbo.bin` | whisper 모델 경로 |
| `RATATOUILLE_HERMES_PROFILE` | (Hermes 기본) | 문서화에 사용할 Hermes profile |
| `RATATOUILLE_SERVER_PORT` | `5174` | 웹 dev 서버의 프록시 대상 포트 |

같은 데이터 폴더에는 서버를 한 대만 띄울 수 있습니다(파일 잠금으로 차단).

## 스크립트

```bash
pnpm dev          # 서버 + 웹 병렬 dev (dev:server / dev:web 개별 실행 가능)
pnpm build        # 재귀 빌드 (웹: tsc -b && vite build)
pnpm test         # 재귀 테스트 — 웹은 Vitest browser mode (Playwright chromium, headless)
pnpm lint         # 재귀 lint
pnpm typecheck    # 재귀 타입체크
pnpm check        # lint + typecheck + test (품질 게이트)
pnpm format       # Prettier
```

테스트는 서버 통합 테스트(수집→전사→교정→문서화→삭제 전 구간), 웹 브라우저 모드 컴포넌트 테스트(가짜 미디어 장치로 녹음 검증), contracts 계약 테스트로 구성됩니다.

## 기술 스택

- **서버**: Hono, @hono/node-server, better-sqlite3, TypeScript (빌드 없이 직접 실행)
- **웹**: React 19, Vite, TanStack Router + Query, Tailwind CSS 4, Radix UI(shadcn 스타일), Vitest browser mode + Playwright
- **계약**: 순수 TypeScript, 런타임 의존성 없음

## 라이선스

`apps/web`은 [shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT, © 2024 Sat Naing) 템플릿에서 파생되었으며, 원본 고지는 [`apps/web/LICENSE`](apps/web/LICENSE)에 유지됩니다. 번들된 [Pretendard](https://github.com/orioncactus/pretendard) 폰트는 SIL Open Font License 1.1을 따릅니다.
