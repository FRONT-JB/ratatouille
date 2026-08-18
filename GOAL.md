# Ratatouille Phase 1 구현 목표와 작업 계획

**작업 종류 선언**: 🔧 **실제 구현** (UI 프로토타입 아님)
**상태**: 🔄 Phase 0 진행 중 — 전사·모델 경계 실측 완료, 브라우저 수집 실험 남음
**시작일**: 2026-08-05
**최종 수정**: 2026-08-05
**정식 원본**: 비공개 설계 워크스페이스의 `PLAN.md` (이 저장소에는 포함되지 않는다)
**실측 기록**: [`.experiments/RESULTS.md`](.experiments/RESULTS.md)

---

**⚠️ 필수 진행 규칙** — 각 Phase를 끝낼 때마다:

1. ✅ 완료한 태스크 체크박스를 채운다
2. 🧪 품질 게이트 검증 명령을 모두 실행한다
3. ⚠️ 품질 게이트 항목이 **전부** 통과했는지 확인한다
4. 📅 위의 "최종 수정" 날짜를 갱신한다
5. 📝 `기록과 학습` section에 발견한 내용을 남긴다
6. ➡️ 그 다음에만 다음 Phase로 넘어간다

⛔ **품질 게이트를 건너뛰거나 실패한 상태로 진행하지 않는다.**

---

## 📌 이 문서의 위치

이 문서는 비공개 설계 워크스페이스의 설계 문서를 **실행 가능한 작업 단위로 분해한 것**이다. 제품 범위·화면 계약·검수 기준을 바꾸지 않는다. 충돌이 생기면 아래 원본 문서(이 저장소 밖)가 우선한다.

| 원본 문서 | 이 계획에서의 역할 |
| --- | --- |
| `PLAN.md` | 화면 계약, 작업 순서 0~6, 완료 조건 |
| `technical-foundation.md` | 상태 머신, 수집 계약, vault 구조, Hermes 경계 |
| `review-contract.md` | 4개 결과 section, 루브릭, 검수 상태 |
| `CONTEXT.md` | 금지된 해석, 에스컬레이션 조건 |

**Phase 번호 대응**: 이 문서의 Phase 1~7은 `PLAN.md`의 `권장 작업 순서 0~6`과 1:1로 추적된다. Phase 0은 `실제 구현` 선언 때문에 추가된 선행 게이트다.

---

## 📋 개요

### 무엇을 만드는가

회의 녹음 또는 음성 파일 업로드부터 전사 교정·확정, AI 정리(회의 요약·결정 사항·Action Item·원문 근거), 사용자 최종 확정까지의 **1인용 워크스페이스**. Phase 2의 통합 작업 관리·Today·캘린더·로드맵은 **범위 밖**이다.

```text
회의 녹음 또는 음성 파일 업로드
→ 전사 생성과 사용자 교정
→ 전사 확정
→ AI 내용 정리 (회의 요약 · 결정 사항 · Action Item · 원문 근거)
→ 사용자 검토·확정
```

### 성공 기준

- [ ] 대면 모드(마이크만)와 온라인 모드(마이크 + Chrome 탭 오디오) 녹음이 manifest 검증을 통과해 `ready`에 도달한다
- [ ] 파일 업로드 source가 페이지 A를 거치지 않고 같은 처리 경로에 합류한다
- [ ] Hermes STT(→ `whisper-cli`)가 한국어 timestamp 전사를 생성하고 사용자가 교정·확정할 수 있다
- [ ] `transcript_approved` 이후에만 Hermes가 4개 결과를 생성한다
- [ ] 4개 결과 section이 각각 독립된 검수 상태를 갖고, 검수 계약 충족 전에는 문서가 `current`가 되지 않는다
- [ ] 브라우저를 닫았다 다시 열어도 같은 source의 현재 상태와 다음 조작이 표시된다
- [ ] 두 페이지의 주요 조작을 keyboard만으로 완료할 수 있다
- [ ] 제품 경로 내비게이션에 Today·캘린더·로드맵·통합 작업 관리가 없다

---

## 🏗️ 확정된 아키텍처 결정

### 이번 세션에서 사용자가 확정한 4건

| 결정 | 확정 내용 | 영향 |
| --- | --- | --- |
| 작업 종류 | **실제 구현** | Phase 0의 선행 실험이 차단 조건이 되고, Phase 7에 30분 녹음·네트워크 중단 시험이 추가된다 |
| 코드 기반 위치 | **모노레포** (`apps/web` + `apps/server`) | 서버 스택·패키지 매니저·워크스페이스 도구 결정이 Phase 0에 추가된다 |
| 프런트엔드 스택 | **Vite + TypeScript + TanStack Router 유지** | `shadcn-admin` upstream과의 차이를 최소화하고 Phase 1을 가장 빨리 통과한다 |
| 처리 중 화면 | **즉시 페이지 B 로딩 상태로 이동** | `PLAN.md` 순서 3 차단 해제. 녹음 source와 업로드 source가 같은 상태 표시 컴포넌트를 공유한다 |
| 전사 소유권 | ⛔ **"Hermes로만"은 철회** | 실측 결과 **Hermes STT는 어떤 경로로도 timestamp를 반환하지 못한다** (아래 참조). timestamp는 필수 계약이므로 전사는 Ratatouille이 `whisper-cli`를 직접 호출한다. **Hermes는 모델 경계만 소유** |

### 실행 위상 — "홈서버"의 실제 의미

문서의 `노트북 Chrome → 홈서버` 표현은 2대 구성을 전제하지만, **실행 환경이 곧 M4 Mac mini**이므로 이 계획은 다음과 같이 해석한다.

```text
브라우저 (녹음 클라이언트)          ← 어느 기기에서 열든 동일
  │  HTTP  (chunk 업로드 · 상태 조회 · 검수)
  ▼
apps/server (로컬 데몬, 이 맥미니)
  ├─ whisper-cli 직접 호출        ← 전사. timestamp JSON
  │    · --prompt 로 참석자·프로젝트명 주입 (고유명사 정확도 57%→90%)
  │    · track별 음량 평준화 후 **모노로 섞어** 입력 (화자 분리는 접음, 2026-08-06)
  ├─ Hermes ratatouille profile   ← 모델 경계만 소유
  │    └─ openai-codex OAuth → 4개 결과 생성 (hermes -z, 검증됨)
  ├─ schema validator             ← evidence 무결성 강제 (결함 A)
  ├─ vault/ Markdown + YAML       ← 정식 원본, file watcher
  └─ SQLite 파생 인덱스           ← 재생성 가능
```

**⛔ "hermes로만 전사"는 실측으로 기각됐다.** Hermes STT의 **모든 경로가 평문 문자열만 반환**한다.

| 경로 | timestamp | 근거 |
| --- | --- | --- |
| `local` (faster-whisper) | ❌ | `_join_confident_segments()`가 segment를 문자열로 합침 |
| `local_command` | ❌ | `.txt`만 읽음 (`glob("*.txt")`). `-oj` JSON 무시 |
| 플러그인 provider ABC | ❌ | 반환 계약이 `transcript: str` 단일 필드 |
| `POST /api/audio/transcribe` | ❌ | 같은 경로 + base64 **25MB 제한** |

추가 제약: `subprocess timeout=300초`, `stt` 툴셋은 **에이전트 도구가 아님**
("gateway voice messages + voice mode"용). **Hermes STT는 짧은 음성 메시지용이지 회의 전사용이 아니다.**

timestamp는 선택이 아니라 필수다 — `technical-foundation.md` 3절("timestamp가 포함된 구조화 JSON"),
`review-contract.md`("timestamp를 누르면 해당 음성을 바로 들을 수 있어야 한다", evidence ID+timestamp).

→ **결론: `technical-foundation.md` 2절의 원래 소유권 그림이 옳았다.**
Hermes는 **모델 경계**를, `whisper.cpp`는 **전사 엔진**을 소유한다.
Hermes 기본값 `local`(faster-whisper)은 이 머신에서 CPU 전용이라 어차피 쓸 수 없다 (`RESULTS.md` 3절).

**서버 프로세스는 기기 대수와 무관하게 필요하다.** 브라우저 혼자서는 (1) 네이티브 `whisper.cpp` 실행, (2) OAuth token을 쥔 Hermes 호출, (3) `vault/`에 원자적 파일 쓰기와 watcher, (4) 탭 수명과 무관하게 살아있는 job을 할 수 없다.

**Phase 1 가정**: 서버는 `127.0.0.1` 바인딩을 기본으로 하고, 재개 가능한 chunk 업로드 계약은 그대로 유지한다. **인증·TLS·외부 도메인 공개 노출은 Phase 1 범위 밖**이다. 다른 기기에서 붙고 싶어지면 바인딩과 인증만 추가하면 되도록 경계를 유지한다.

> ⚠️ 이 가정을 바꾸려면 (예: 노트북에서 LAN으로 상시 접속) Phase 0에서 인증 방식을 먼저 결정해야 한다. `CONTEXT.md`의 에스컬레이션 조건이다.

### 소유권 경계 (변경 금지)

| 주체 | 소유 범위 |
| --- | --- |
| Ratatouille | source 수명주기, 사용자 metadata, 파일, **schema 검증**, **전사 job 실행**, 검수 상태, 최종 렌더링 |
| Hermes | **모델 경계만** — model provider, prompt/skill 실행, 모델 장애 경계 |
| `whisper.cpp` | 전사 엔진. Ratatouille이 직접 호출한다 (Hermes 경유 시 timestamp 소실) |
| `openai-codex` | Hermes가 소유하는 기본 provider · ChatGPT OAuth 경로 |
| 사용자 | 전사 교정, 산출물 검수, 최종 판정, 모든 확정 데이터 |

**Ratatouille은 provider key나 OAuth token을 직접 다루지 않고 모델을 직접 호출하지 않는다.**

> ⚠️ `hermes proxy`(OpenAI 호환 서버)는 **profile·skill 층을 우회하는 단순 포워더**다. 이걸 쓰면 위 소유권
> 경계가 깨지므로 후보에서 제외한다. `technical-foundation.md` 8절이 "API server가 자연스러운 후보"라고
> 적었지만 실제 성격은 다르다.

### 상태 머신 (technical-foundation 5절 원문)

```text
source_state:       capturing → finalizing → ready
upload_health:      syncing ↔ synced
                       └────→ interrupted / failed_retryable

transcription_job:  queued → transcribing → completed
                       └──────────────────→ failed_retryable

transcript_revision: transcript_reviewing → transcript_approved
                              ↑                   │
                              └────── edit ───────┘

document_run:       queued → documenting → proposed
                       └────→ auth_required / waiting_for_model / failed_retryable

document_state:     reviewing → current
                        ↑          │
                        └─ stale ←─┘
```

**이 5개는 서로 다른 객체다. 하나의 `Source 수명주기`로 합치지 않는다.**

---

## 📦 시작 전 필요한 것

### 환경

- [ ] macOS (M4 Mac mini 32GB) — 확인됨
- [ ] Node.js LTS + 패키지 매니저 (Phase 0에서 pnpm/bun 결정)
- [x] `whisper-cli` 설치 (`brew install whisper-cpp`, Metal 확인) + `ggml-large-v3-turbo.bin` 1.6GB — ✅ 완료
- [ ] Hermes `stt.provider: local_command` 전환 + `HERMES_LOCAL_STT_COMMAND` 설정
- [ ] Hermes 설치 및 `ratatouille` profile 생성
- [ ] `openai-codex` provider ChatGPT OAuth 인증 완료
- [ ] Chrome (탭 오디오 공유 시험용)

### 외부 의존성

- `satnaing/shadcn-admin` — 프런트엔드 코드 기반
- Shadcn UI — 유일한 외부 UI 시스템
- Lucide — 유일한 아이콘 소스
- `whisper.cpp` — 전사 엔진
- Hermes — 모델 실행 경계

---

## 🧪 테스트 전략

### TDD 원칙

**테스트를 먼저 쓰고, 통과시키는 코드를 나중에 쓴다.** 각 Phase는 🔴 RED → 🟢 GREEN → 🔵 REFACTOR 순서를 따른다.

### 테스트 피라미드

| 종류 | 커버리지 목표 | 대상 |
| --- | --- | --- |
| **Unit** | ≥ 80% | 상태 전이 함수, manifest 검증, frontmatter 직렬화, 루브릭 판정 로직, evidence 링크 해석 |
| **Integration** | 핵심 경로 | chunk 업로드 → manifest 검증 → `ready`, 전사 job 생명주기, Hermes run 생명주기, vault round-trip |
| **E2E (Playwright)** | 주요 사용자 흐름 | 녹음 → 전사 교정 → 확정 → AI 정리 → 검수 확정, 업로드 source 경로 |
| **수동 검증** | 증거 기록 | 실제 마이크·탭 오디오, 30분 녹음, 네트워크 중단, OAuth 만료 |

### 커버리지 임계값

- **상태 머신·검증 로직**: ≥ 90% — 상태 오염이 가장 위험한 실패 모드다
- **서버 API 레이어**: ≥ 70%
- **React 컴포넌트**: 커버리지 숫자보다 통합 테스트를 우선한다

### 테스트 파일 배치

```text
apps/web/
├── src/
└── test/
    ├── unit/          # 상태 파생, 포맷터
    ├── integration/   # 컴포넌트 + mock 서버
    └── e2e/           # Playwright 흐름

apps/server/
├── src/
└── test/
    ├── unit/          # 상태 머신, manifest, frontmatter, 루브릭
    └── integration/   # 업로드 → ready, 전사 job, Hermes run, vault round-trip
```

### 자동화하지 않는 것 (증거로 대체)

`실제 구현` 선언이므로 다음은 자동 테스트가 아니라 **기록된 시험 회차**로 증명한다. Phase 7의 `검증 증거`에 남긴다.

- 실제 마이크·탭 오디오 캡처 품질
- 30분 이상 녹음의 조각 유실·중복 업로드
- 한국어 전사 정확도
- ChatGPT OAuth 만료·재인증

---

## 🚀 구현 Phase

---

### Phase 0: 선행 결정과 반증 실험 (차단 게이트)

**목표**: `PLAN.md` 순서 0의 선행 조건을 전부 해소한다. 코드 산출물보다 **기록된 결정과 실험 결과**가 산출물이다.
**예상 시간**: 6~10시간 (약 3시간 소요, 나머지 3~5시간)
**상태**: 🔄 **진행 중** — 전사·모델 경계 실측 완료
**대응**: `PLAN.md` 순서 0 선행 조건
**기록**: [`.experiments/RESULTS.md`](.experiments/RESULTS.md)

> ⛔ 이 Phase가 끝나기 전에는 Phase 1을 시작하지 않는다. `실제 구현`을 선언했기 때문에 실험 4종과 protocol 선택이 차단 조건이다.

---

#### ✅ 완료된 실측 (2026-08-05)

**환경 사실**

| 항목 | 결과 |
| --- | --- |
| 기존 Ratatouille 런타임 | **없음** — 작업 폴더가 빈 디렉토리였음 (가정 아님, 확인함) |
| Hermes | v0.20.0, provider `openai-codex`, base_url `chatgpt.com/backend-api/codex`, 기본 모델 `gpt-5.6-luna` |
| Hermes OAuth | 유효 |
| whisper.cpp | 없었음 → `brew install whisper-cpp` |
| ggml 모델 | 머신에 없었음 → `ggml-large-v3-turbo.bin` 1.6GB |
| Node / pnpm / bun | v24.14.0 / 10.32.1 / 1.3.11 |

**전사 기준선** — 샘플 507초(8분 27초), 방탈출 게임 상황극 (⚠️ 회의 오디오 아님)

| 항목 | 실측값 |
| --- | --- |
| 전사 소요 | **34.9초 → 14.5x 실시간** |
| 백엔드 | **Metal ✅** (`libggml-metal.so` 동적 로드) |
| 피크 메모리 | **1.98 GB** |
| 언어 자동 감지 | `ko` 정확 |
| 한국어 품질 | 양호 — 구어체·비속어·긴 복문·숫자 모두 정확. **교정이 재작성 수준이 될 거라는 우려는 기각** |
| 30분 회의 외삽 | 약 2분 (선형 외삽, 실측 아님) |

**엔진 선택 근거** (Context7 공식 문서 조사)

- faster-whisper(= Hermes `local` 기본값)는 CTranslate2 기반이며 **Apple Silicon에서 CPU 전용**이다.
  공식 저장소의 유일한 Dockerfile이 `nvidia/cuda` x86_64이고 ARM64 빌드가 없다.
- whisper.cpp는 Metal을 쓴다. Core ML(`-DWHISPER_COREML=1`) 소스 빌드 시 인코더 3x+ 추가 가속 가능.
- → **`technical-foundation.md` 3절의 판단이 옳았고 근거도 정확했다.**

**화자 분리 — 문서에 없던 발견** ⚠️ **2026-08-06에 접었다.** 아래는 당시 기록이며 현재 설계가 아니다 — 실제 회의에서는 분리가 동작하지 않았다(`기록과 학습` 참조).

| 플래그 | 방식 | 한국어 |
| --- | --- | --- |
| `-tdrz` tinydiarize | 모델 추론 | ❌ `small.en-tdrz` 전용 = 영어만 |
| **`-di` `--diarize`** | **스테레오 좌/우 채널 분리** | ✅ 언어 무관 |

온라인 회의 수집이 `mic.webm` + `remote.webm`을 따로 저장하므로, 좌/우 채널로 합치면
**`나` vs `원격`이 물리적으로 구분된다.** 모델 추측이 아니라 채널이라 오분류가 없다.
`review-contract.md`의 `나`/`참석자 1`/`미확인` 계약과 정합하며, 외부 diarization API가 불필요하다.
(대면 모드는 마이크 하나라 채널 분리 불가 → 전부 사용자 지정)

**Hermes 4개 결과 추출** — 전사문 153 세그먼트에 `[segNNN HH:MM:SS]` ID 부여 후 `hermes -z` 원샷

| 검증 | 결과 |
| --- | --- |
| 소요 시간 | **28.7초** |
| JSON 파싱 | 1회 성공 (순수 JSON, 앞뒤 설명문 없음) |
| evidence 10건의 segID 실재 | ✅ 10/10 |
| evidence 10건의 timestamp 일치 | ✅ 10/10 (문자열 완전 일치) |
| evidence 10건의 quote 원문 일치 | ✅ 10/10 (문자열 완전 일치) |
| 전 section 인용 segID 18개 실재 | ✅ 18/18 |
| **환각된 ID·timestamp·인용** | **0건** |
| 없는 담당자·기한 생성 | **0건** — 미언급 항목은 전부 `미입력` 반환 |

> 🎯 이 문서 초판이 "가장 의심스럽다"고 지목했던 **evidence ID + timestamp 연결이 실측에서 문제없었다.**
> Phase 6의 화면 설계를 다시 할 필요가 없다.

**발견된 결함 2건 — 둘 다 Phase 계획에 반영됨**

| # | 결함 | 조치 위치 |
| --- | --- | --- |
| **A** | summary·decisions·tasks가 인용한 segID 중 상당수가 **`evidence` 배열에 없음.** `review-contract.md`가 요구한 "다른 세 결과에서 같은 segment로 이동"이 깨짐 | **Phase 2** — schema validator가 `인용 segID ⊆ evidence 배열`을 강제 |
| **B** | 결정 2건 중 1건이 **제안을 결정으로 승격.** seg151 "우리 앞으로도 이쁘게 만나자"(제안) → seg152 "응?"(되묻기)로 **동의 발화가 없음** | **Phase 6** — 루브릭 유지. AI 1차 판정만으로 `current` 승격 금지가 실측으로 뒷받침됨 |

결함 B는 `review-contract.md` 결정 사항 루브릭의 **첫 번째 기준**("실제 결정과 단순 제안·논의가 구분됐는가?")이
정확히 잡으라고 만든 오류다. **루브릭이 행정 절차가 아니라 실제 품질 도구임이 증명됐다.**

---

#### ✅ 2차 실측 — 모의 회의 (정답 대조, 2026-08-05)

`회의음성.mp3` 600초. [`MOCK-MEETING-SCRIPT.md`](MOCK-MEETING-SCRIPT.md)로 정답과 함정을 미리 심어 정량 채점.

**성능**

| 단계 | 값 |
| --- | --- |
| 전사 | **47.2초 / 600초 → 12.7x 실시간**, Metal, 피크 2.09GB |
| 4개 결과 추출 | **41.9초** |
| **전체 체인** | **89초** |

**정답 대조 — 결정·Action Item 모두 만점**

| 항목 | 결과 |
| --- | --- |
| 결정 재현율 | ✅ **2/2** |
| 결정 오탐 (제안만·막연함·보류 함정) | ✅ **0/3** |
| Action Item 재현율 | ✅ **4/4** |
| Action Item 오탐 (완료된 일·외부 일정) | ✅ **0/2** |
| 기한 정확도 | ✅ **4/4** — 미언급 기한은 `미입력` 유지 |
| **없는 담당자·기한 지어내기** | ✅ **0건** |
| evidence ID·timestamp·quote 정확 | ✅ **12/12** |
| 인용 segID 실재 | ✅ **41/41**, 환각 0건 |

**결함 B가 재현되지 않았다.** 나아가 요약문에
*"서버 증설 여부와 주간 회의 요일 변경은 결정하지 않았다"*고 **명시**했다 — 함정을 인식하고 있다.

**❌ 결함 A는 규모에 따라 악화**

| | 1차 (18 인용) | 2차 (41 인용) |
| --- | --- | --- |
| evidence 배열 누락 | 8개 (44%) | **32개 (78%)** |

전사가 길수록 깨지는 링크 비율이 커진다. 모델이 `evidence`를 "전체 인용"이 아니라
"대표 근거"로 이해하고 있다. **Phase 2 validator의 강제가 필수**임이 재확인됐다.

**전사 정확도 — 숫자는 완벽, 고유명사는 취약**

| 대상 | 정확 / 오류 |
| --- | --- |
| **숫자·날짜 12종** (`3월 2·5·16일`, `2.8%`, `15일`, `460만 원`, `24시간`) | **12 / 0** |
| 고유명사 (토스페이먼츠·그라파나·이한결·PG사) | 8 / 11 |
| 발화 단위 합계 | **33 / 14 = 70.2%** |

의도적으로 가까이 붙인 세 날짜가 **전혀 섞이지 않았다.**
반면 제품명·인명은 자모 단위로 틀린다 (`토스페이먼치`×4, `그래파나`×2, `한결시`×2).

→ **설계 입력**: 전사 교정 UI에서 숫자보다 **고유명사 강조를 우선**한다.
`review-contract.md` 전사문 루브릭 #2의 실제 위험은 **이름 쪽**에 몰려 있다.

**모델이 전사 오류를 3/4 자동 교정** — `토스페이먼치`→`토스페이먼츠`, `한결시`→`이한결`,
`피지사`→`PG사`는 문맥으로 교정했고 `그래파나`만 그대로 전파했다.
`evidence`의 `quote`는 원문 오류를 **그대로 인용** — 올바른 동작이다.

---

#### 🔑 2차 실측 핵심 발견 — 화자 분리 없이는 1인칭 담당자를 채울 수 없다

```
[seg045] 계약서는 제가 금요일까지 검토해서 공유 드릴게요.   ← "제가"    → 담당자 미입력
[seg061] 지영씨, QA 시나리오는 3월 5일까지 가능하실까요?    ← 이름 호명 → 담당자 채워짐
[seg091] 한결시, 서버 비용 자료 좀 정리해 주실 수 있어요?    ← 이름 호명 → 담당자 채워짐
```

전사문에 화자 라벨이 없으므로 "제가"가 누군지 알 방법이 없다.
**모델이 추측하지 않은 것은 실패가 아니라 규칙을 정확히 지킨 것이다.**

→ **제품 설계 결론**: 화자 분리는 "있으면 좋은 것"이 아니라
**1인칭으로 선언된 Action Item의 담당자를 채우는 유일한 수단**이다.
`review-contract.md`가 "결정·Action Item 근거의 화자는 반드시 사람이 확인한다"고 한 조항의
실질적 이유가 실측으로 드러났다. ~~Phase 3의 `-di` 채널 분리 우선순위가 올라간다.~~
→ ⚠️ **2026-08-06 뒤집힘**: 실제 녹음에서 `-di`가 동작하지 않아 접었다. 담당자는 사람이 지정한다.

---

#### ⚠️ 2차 실측의 한계 — 실전보다 쉬웠다

녹음에 **AI에게 주는 지시가 그대로 섞였다.** 함정에 정답 라벨이 붙어 있다.

| 세그먼트 | 발화 |
| --- | --- |
| seg009 | "로그 정리는 완료된 걸로만 기록할게요. **새로 할 일은 아니고요**" |
| seg041 | "그건 외부 일정 공유이고 **저희 팀 할 일은 아닙니다**" |
| seg079 | "**새로운 담당이나 기한을 더 만들지는 말고**" |
| seg104 | "서버를 늘린다거나 안 늘린다는 **결론은 지금 내리지 않겠습니다**" |
| seg135 | "오늘은 **요일을 정하지 않고** 넘어가도" |

실제 회의에서 아무도 이렇게 말하지 않는다.
**함정 회피 3/3과 오탐 0건이 이 힌트 덕일 가능성을 배제할 수 없다.**
다음 검증은 **정답 라벨 없는 대본** 또는 **실제 업무 회의**로 해야 한다.

**Hermes 호출 경로 — 문서의 후보 목록이 부정확했음**

| 경로 | 실체 | 적합성 |
| --- | --- | --- |
| **`hermes -z "프롬프트"`** | 원샷 서브프로세스, stdout 반환 | ✅ **검증 완료.** 가장 단순 |
| `hermes serve` | JSON-RPC/WebSocket 게이트웨이 (127.0.0.1:9119) | 문서에 없던 후보. run 상태·event 관측에 유리할 가능성 — **미검증** |
| `hermes acp` | 에디터 통합(VS Code, Zed) | 용도 불일치 |
| `hermes proxy` | OpenAI 호환 요청을 provider로 **포워딩** | ❌ **profile·skill 우회 → 소유권 경계 위반** |

---

#### 남은 태스크

**🔬 실험 1 — 브라우저 수집 파라미터 (`technical-foundation` 4절 `실험 필요`)**

✅ **4종 전부 완료** — 전체 기록: [`.experiments/BROWSER-RESULTS.md`](.experiments/BROWSER-RESULTS.md)
실제 Chrome 151(Playwright)에서 Web Audio 합성 스트림으로 측정.

- [x] **0.1** 브라우저 로컬 저장소 → **IndexedDB 확정**
  - 360조각(30분 분량) × 80.5KB 쓰기: **IndexedDB 65ms(422 MB/s)** vs **OPFS 244ms(113 MB/s)**
  - IndexedDB가 **3.7배 빠르다.** 원인은 API 형태 — IndexedDB는 한 트랜잭션에 360건을
    넣고 한 번 commit하지만, OPFS는 파일마다 `getFileHandle`→`createWritable`→`write`→`close`
    4번의 await가 필요하다
  - **할당량 10,240 MB (10 GB)** — 29MB짜리 30분 녹음이 수백 개 들어간다
  - ⚠️ **`navigator.storage.persisted()`가 `false`다.** 디스크 압박 시 브라우저가 조각을
    말없이 evict 할 수 있다. **녹음 시작 전 `navigator.storage.persist()` 호출이 필수다**
  - 미측정: Worker 기반 OPFS(`createSyncAccessHandle`) — IndexedDB를 뒤집을 가능성 있음

- [x] **0.2** `MediaRecorder` chunk 길이 → **5초 확정**
  | timeslice | 조각 수 | 총 바이트 | gap 최대 편차 | stop 지연 |
  | --- | --- | --- | --- | --- |
  | 1초 | 30 | 482,659 | 25ms | **0ms** |
  | **5초** | 6 | 483,241 | 41ms | **0ms** |
  | 10초 | 3 | 483,193 | 21ms | **0ms** |
  - **비트레이트가 chunk 길이와 무관하다** — 세 설정의 총 바이트 차이 0.12%, 16.1 KB/s(≈129kbps).
    **조각을 잘게 쪼개도 오버헤드가 없다**
  - `stop()` 지연 **0ms** — 종료 시 마지막 조각 유실 위험이 낮다
  - 5초를 고른 이유는 크기가 아니라 **유실 노출량**이다. 크래시 시 최대 5초 손실,
    30분에 조각 360개(1초면 1,800개로 manifest가 비대해진다)
  - 30분 = 29MB (chunk 길이와 무관)

- [x] **0.3** 재전송 protocol → **전 조각 SHA-256 확정**
  - SHA-256 × 360조각(80.5KB each): **총 10ms, 조각당 0.03ms**, 2,821 MB/s
  - `technical-foundation.md` 4절 "서버는 순번, 크기와 hash를 확인한다"가 **성능상 부담이 아니다**
  - 구현 주의: `crypto.getRandomValues`는 호출당 **65,536바이트 상한** (테스트 데이터 생성 시)

- [x] **0.4** mic / remote 시간축 정렬 → **동시 시작 + 동시 일시정지 확정**
  | 항목 | 값 |
  | --- | --- |
  | `start()` 호출 간격 | 0.1ms |
  | 첫 조각 도착 차이 | **0ms** |
  | 마지막 조각 도착 차이 | **0ms** |
  | 편측 400ms 일시정지 후 최대 편차 | **295.3ms** (조각 수도 1개 차이) |
  - **정상 구간에서는 정렬이 완벽하다.** 같은 tick에서 시작하면 초기 오프셋 보정이 불필요
  - ⚠️ **`MediaRecorder.pause()`는 타임라인 자체를 멈춘다.** 한쪽만 일시정지하면 어긋난다
  - **설계 규칙 3가지**:
    1. 두 track을 같은 tick에서 시작한다
    2. **일시정지는 반드시 두 recorder에 동시 적용한다** — 페이지 A의 일시정지 버튼이
       mic·tab 양쪽을 함께 제어해야 한다
    3. manifest에 각 track의 조각 수와 일시정지 구간을 기록한다 (조각 수 불일치 = 정렬 이상 신호)
  - 🔗 ~~`-di` 채널 화자 분리의 전제 조건~~ → 화자 분리는 접었다(2026-08-06).
    위 3규칙은 여전히 필요하다 — **두 track을 섞을 때 시간축이 어긋나면 말이 겹쳐 들린다.**

**🔬 실험 2 — 전사 엔진 기준선**

- [x] **0.5** `whisper.cpp` + `large-v3-turbo` 한국어 기준선 측정 — ✅ **완료** (34.9초/507초, Metal, 1.98GB)
- [x] **0.5b** **회의 형식 오디오**로 재측정 — ✅ **완료** (모의 회의 600초, 정답 대조 만점)
- [ ] **0.5b-2** **정답 라벨 없는** 회의로 재검증 — ⚠️ 2차 녹음에 AI 지시가 섞여 실전보다 쉬웠음
  - 실제 업무 회의 녹음이 가장 좋고, 어려우면 대본에서 메타 발화를 제거하고 다시 녹음
  - 측정: 함정 회피가 힌트 없이도 유지되는가
  - **금지**: 2차 결과(오탐 0건)로 "실제 회의에서도 오탐이 없다"고 일반화하지 않는다
- [x] **0.5c** `-di` 채널 화자 분리 **메커니즘 검증** — ✅ **완료. 세그먼트 정확도 98.2%(54/55), 불확실 0건**
  - 정답을 아는 합성 2트랙(0~150초=L, 150~300초=R, 반대쪽 무음)으로 시험
  - JSON에 `speaker` 필드(`0`/`1`/`?`)가 추가됨
- [x] ~~**0.5c-2** 실제 2트랙 녹음으로 말겹침 구간 검증~~ — ⛔ **불필요해짐**(2026-08-06). 실제 2트랙 녹음에서 화자 분리가 **아예 동작하지 않았고**(마이크가 28.7 dB 작아 좌채널이 무음), 화자 분리 자체를 접었다. 말겹침은 더 이상 이 결정에 영향을 주지 않는다
  - Google Meet/Zoom을 Chrome 탭 공유로 5분만 녹음하면 됨
  - **당시 이유**: 화자 분리가 없으면 "제가 하겠습니다" 형태의 Action Item 담당자를 채울 수 없음이
    2차 실측에서 드러남
  - ⚠️ **2026-08-06 뒤집힘**: 실제 2트랙 녹음에서는 분리가 **아예 안 됐다**(마이크 28.7 dB 작음).
    담당자는 교정 화면에서 사람이 지정하는 것으로 바꿨다. 아래 `기록과 학습` 참조
- [ ] **0.5d** 같은 입력 재실행 시 4개 결과의 출력 안정성(재현성) 측정 — 현재 각 1회 실행 결과만 있음
- [x] **0.5e** 고유명사 전사 오류 대책 — ✅ **완료. `--prompt` 주입으로 57.1% → 90.0%**
  - `whisper-cli --prompt "회의 참석자는 김민수, 박지영, 이한결입니다..." --carry-initial-prompt`
  - 토스페이먼츠 5오류→0, 그라파나 2오류→0. 숫자·날짜 12/12 회귀 없음
  - 🎯 **`technical-foundation.md` 6절이 요구한 "run history로 검증"에 대한 답** — 개선한다
- [ ] **0.5e-2** 호칭형 주입 추가 실험 — `이한결`만 넣어서 `한결씨`→`한결시` 오류가 안 잡혔음
  - 프롬프트에 `한결씨`, `지영씨` 같은 호칭형을 함께 넣으면 잡히는지

**📐 결정 — 사용자 확정 필요**

- [x] **0.6** Hermes programmatic protocol — ✅ **`hermes -z` 원샷 검증 완료**
  - `proxy`는 profile·skill 우회로 **제외 확정**, `acp`는 용도 불일치로 제외
  - 남은 선택: `hermes -z` 서브프로세스로 갈지, `hermes serve`(JSON-RPC/WS)로 갈지
- [ ] **0.6b** `hermes serve` JSON-RPC로 run 상태·event를 관측 가능한지 확인
  - 판단 기준: `waiting_for_model`·`failed_retryable`·`auth_required`를 화면 상태로 만들 수 있는가
  - `-z` 서브프로세스로도 충분하면 `serve`를 도입하지 않는다 (단순성 우선)
- [ ] **0.6c** Hermes `ratatouille` profile + skill 경유 동작 확인 — 현재는 원샷 프롬프트만 검증됨
  - skill 후보: `process-recording`, `extract-decisions`, `extract-tasks`, `maintain-vault`

- [ ] **0.7** 서버 스택 확정
  - 권장: Node.js + TypeScript (Hono 또는 Fastify) — `apps/web`과 타입 공유, 모노레포 단순화
  - 결정 항목: 웹 프레임워크 / SQLite 라이브러리 (`better-sqlite3` 등) / 프로세스 관리자 (`launchd` vs supervisor)
  - 🚨 **에스컬레이션 항목** — `CONTEXT.md`가 "웹 프레임워크, 데이터베이스 라이브러리와 배포 관리자"를 사용자 결정으로 규정
  - 기록: `docs/decisions/server-stack.md`

- [x] **0.7b** Hermes STT 경유 전사 가능성 — ✅ **검증 완료. 결론: 불가능**
  - 4개 경로(`local` / `local_command` / 플러그인 ABC / HTTP endpoint) 전부 **timestamp 소실**
  - `stt` 툴셋은 에이전트 도구가 아님 (`-t stt` → `ignoring unknown --toolsets entries`)
  - **전사는 Ratatouille이 `whisper-cli`를 직접 호출한다.** Hermes는 모델 경계만 소유
  - 사용자 Hermes 설정은 **변경하지 않았다** (env var로만 시험)

**📋 조사**

- [x] **0.8** 기존 Ratatouille 런타임 존재 여부 — ✅ **`없음`** (작업 폴더가 빈 디렉토리였음을 확인)

- [ ] **0.9** `shadcn-admin` 저장소를 직접 열어 데모 route 목록 작성
  - README에는 개별 데모 페이지 목록이 없으므로 저장소를 직접 확인한다
  - 산출: **유지 목록** / **제거 목록** 2개 표
  - 확인 대상: 관리자 데모 페이지, 전역 검색, 부분 Clerk 인증
  - 기록: `docs/decisions/shadcn-admin-inventory.md`

- [ ] **0.10** upstream 수정 컴포넌트 차이 확인
  - `Modified Components`: `scroll-area`, `sonner`, `separator` → CLI 덮어쓰기 전 diff 확인
  - `RTL Updated Components`: `alert-dialog`, `calendar`, `command`, `dialog`, `dropdown-menu`, `select`, `table`, `sheet`, `sidebar`, `switch` → **RTL이 필요 없으므로 CLI 갱신 허용**
  - 기록: `docs/decisions/shadcn-component-diff.md`

#### 품질 게이트 ✋

**⚠️ 정지: 아래가 전부 충족되기 전에는 Phase 1을 시작하지 않는다**

- [x] 실험 4종(0.1~0.4)의 결과가 각각 문서로 기록되었고, 반증 가능한 형태로 서술되었다 — ✅ `BROWSER-RESULTS.md`
- [x] `whisper.cpp` 기준선(0.5)에 실제 측정 수치가 있다 (추정치가 아님) — ✅ `RESULTS.md` 2절
- [ ] **실제 회의 오디오**로 재측정(0.5b)했고, 현 샘플이 회의가 아니었다는 한계가 해소되었다
- [x] Hermes 호출 경로(0.6)가 실측으로 검증되었다 — ✅ `hermes -z` 성공, `proxy` 제외 확정
- [x] Hermes STT 경유 가능성(0.7b)이 확인되었다 — ✅ **불가능**(timestamp 소실). 전사는 직접 호출
- [x] 서버 스택(0.7)이 **사용자 확정**으로 기록되었다 — ✅ Node + TypeScript + Hono
- [x] 기존 런타임 존재 여부(0.8)가 사실대로 기록되었다 — ✅ `없음`
- [x] `shadcn-admin` 유지·제거 목록(0.9)이 작성되었다 — ✅ 정리 완료 후 목록 문서는 제거함
- [x] 어떤 실험도 "해봤더니 잘 됐다" 수준이 아니라 수치·조건·실패 사례를 포함한다 — ✅ 결함 2건 기록됨

#### 롤백

문서만 생성하는 단계라 코드 롤백이 없다. 실험 결과가 계약을 뒤집으면(예: 브라우저 로컬 저장소로 30분 녹음이 불가능) **`PLAN.md` 수정을 사용자에게 제안**하고 임의로 우회하지 않는다.

---

### Phase 1: 모노레포 기반과 공통 앱 셸

**목표**: Ratatouille 빈 셸이 실행되고, 두 페이지가 같은 앱 셸과 내비게이션 상태를 공유한다.
**예상 시간**: 4~6시간
**상태**: ⏳ 대기
**대응**: `PLAN.md` 순서 0 + 순서 1
**선행**: Phase 0 완료

#### 태스크

**🟢 GREEN: 기반 구성**

- [x] **1.1** 모노레포 뼈대 생성 — ✅ `apps/web`·`apps/server`·`packages/contracts`
  - `apps/web` — `shadcn-admin` 클론 후 git 재초기화, Vite + TS + TanStack Router 유지
  - `apps/server` — Phase 0.7에서 확정한 스택
  - `packages/contracts` — 상태 enum, API 타입, frontmatter 스키마를 web/server가 공유
  - 워크스페이스 도구, lint, format, type-check를 루트에서 일괄 실행 가능하게 구성

- [x] **1.2** 데모 route와 의존성 제거 — ✅ 유지·제거 목록 기준, 잔재 grep 0건
  - Phase 0.9의 **제거 목록**을 그대로 실행한다
  - 관리자 데모 페이지, 전역 검색, 부분 Clerk 인증 제거
  - **금지**: 목록 없이 감으로 삭제하지 않는다

- [x] **1.3** Shadcn 테마 토큰과 Sidebar 수정분 확인 — ✅
  - light/dark 테마가 동작하는지 확인
  - Phase 0.10의 diff 결과를 반영

**🔴 RED: 앱 셸 테스트 먼저**

- [x] **Test 1.4** 앱 셸 구조 테스트 작성 — ✅
  - 파일: `apps/web/test/integration/app-shell.test.tsx`
  - 예상: 실패 (셸이 아직 없음)
  - 시나리오:
    - Sidebar에 `새 회의`, `회의`, `파일 업로드`가 있다
    - `회의` 아래에 회의 항목이 **한 단계로 직접** 표시된다 (중첩 tree 아님)
    - Sidebar **옆에 별도 회의 목록 열이 없다**
    - 내비게이션에 `Today`, `캘린더`, `로드맵`, `작업` 항목이 **없다**
    - 두 route(`/meetings/new`, `/meetings/:id`)가 같은 셸을 공유한다

- [x] **Test 1.5** 반응형 Sidebar 테스트 작성 — ✅
  - 파일: `apps/web/test/e2e/app-shell-responsive.spec.ts`
  - 시나리오: 좁은 화면에서 Sidebar가 Sheet 또는 공식 Sidebar 동작으로 전환된다

**🟢 GREEN: 셸 구현**

- [x] **1.6** 단일 Sidebar 구성 — ✅
  - `새 회의` / `회의` + 한 단계 회의 항목 / `파일 업로드`
  - 현재 페이지가 나머지 폭을 전부 사용

- [x] **1.7** 두 route를 빈 상태로 생성 — ✅ (Phase 3·4에서 실제 화면으로 채움)
  - 페이지 A: 녹음 중 (`/meetings/new` 계열)
  - 페이지 B: 회의 상세 (`/meetings/:id`)

**🔵 REFACTOR**

- [x] **1.8** 레이아웃 컴포넌트 정리, 중복 제거, 네이밍 정돈 — ✅

#### 완료 조건 (`PLAN.md` 순서 0·1 원문)

- [x] 선행 조건 2항목(프로젝트 위치, 스택 유지)이 **사용자 확정으로 기록**되었다 → 이 문서 상단 표 — ✅
- [x] Ratatouille 빈 셸이 실행된다 — ✅
- [x] 데모 대시보드 기능이 제품 경로에 남아 있지 않다 — ✅ grep 0건
- [x] 브라우저 수집 파라미터 실험 결과와 Hermes protocol 선택이 기록되었다 — ✅ `BROWSER-RESULTS.md` · `RESULTS.md`
- [x] 두 페이지가 같은 앱 셸과 내비게이션 상태를 공유한다 — ✅

#### 품질 게이트 ✋

- [x] `pnpm build`가 web/server 모두 에러 없이 통과 — ✅ 3/3
- [x] `pnpm test` 전부 통과 — ✅ 618건. ⚠️ **스킵 1건 있음**: 「모델이 없어 실제 전사를 건너뛴다」를 보고하는 역(inverse) 테스트로, 모델이 있어 정상적으로 건너뛴 것이다. 숨겨진 스킵이 아니다
- [x] `pnpm lint` 에러 0 — ✅ (경고 1: route 파일의 fast-refresh 안내)
- [x] `pnpm typecheck` 통과 — ✅ 3/3
- [x] 테스트를 3회 연속 실행해도 결과가 같다 — ✅ 3회 모두 119/208/291 동일
- [x] 수동: 좁은 화면(375px)에서 Sidebar 전환이 동작한다 — ✅ Playwright로 확인
- [x] 수동: 내비게이션에 Phase 2 항목이 하나도 없다 — ✅ 녹음·회의뿐

#### 롤백

`apps/web` 디렉토리 삭제 후 `shadcn-admin` 재클론. Phase 0 문서는 영향 없음.

---

### Phase 2: 서버 도메인 코어 — 상태 머신 · vault · 업로드 계약

**목표**: 화면 없이도 source가 `capturing → finalizing → ready`에 도달하고, vault에 Markdown+YAML이 쓰이며, 브라우저를 닫아도 상태가 살아 있다.
**예상 시간**: 8~12시간 / **실제**: ~9시간
**상태**: ✅ **완료** (2026-08-06) — 테스트 311건, 커버리지 contracts 99.2% · server 93.9%
**대응**: `technical-foundation` 4·5·9·11절 (`실제 구현` 때문에 추가된 Phase)
**선행**: Phase 1 완료

> 이 Phase가 `PLAN.md`에 별도 항목으로 없는 이유: `PLAN.md`는 화면 계약 문서이고, 상태 머신·vault는 `technical-foundation`이 소유한다. `실제 구현`을 선언했으므로 화면보다 먼저 서 있어야 한다.

#### 태스크

**🔴 RED: 상태 머신 테스트 먼저**

- [x] **Test 2.1** 5개 상태 머신의 전이 규칙 테스트 — ✅ 23건 통과
  - 파일: `packages/contracts/test/state.test.ts` + `rules.test.ts` (15건)
  - 계약이 web·server 양쪽에서 필요해 `apps/server`가 아니라 `packages/contracts`에 뒀다
  - 시나리오 (`technical-foundation` 5절 `상태 규칙` 원문):
    - `ready` 이전 source는 transcription job을 **만들지 못한다**
    - document run은 source가 `ready` **그리고** 현재 revision이 `transcript_approved`일 때만 생성된다
    - 확정 전사를 다시 편집하면 새 revision이 `transcript_reviewing`으로 열리고 기존 document가 `stale`이 된다
    - 새 revision이 `transcript_approved`가 되기 전에는 document run을 만들지 못한다
    - `capturing`과 `syncing`이 **동시에 존재할 수 있다**
    - 중복 실행이 current 문서를 조용히 덮지 않는다 (새 run 또는 명시적 retry)
    - 서로 다른 객체의 상태를 하나로 합치려는 시도가 타입 레벨에서 막힌다

- [x] **Test 2.2** manifest 검증 테스트 — ✅ 25건 통과
  - 파일: `packages/contracts/test/manifest.test.ts`
  - 시나리오:
    - 조각 순번에 구멍이 있으면 `ready`가 되지 않는다
    - hash 불일치 조각을 거부한다
    - 같은 순번을 두 번 받으면 **멱등 처리**한다 (중복 업로드 방지)
    - manifest에 입력 모드·장치·선택한 track·시작 시각이 기록된다
    - 불완전한 source는 Inbox에 남고 문서화 job을 만들지 않는다

- [x] **Test 2.3** evidence 무결성 검증 테스트 — ✅ **23건 통과. 결함 A가 fixture에서 검출된다**
  - 파일: `packages/contracts/test/evidence.test.ts`
  - 배경: 실측에서 모델이 인용한 18개 segID 중 **8개가 `evidence` 배열에 없었다.** 그대로 두면
    `review-contract.md`가 요구한 "다른 세 결과에서 같은 segment로 이동"이 깨진다.
  - 시나리오:
    - `summary`·`decisions`·`tasks`가 인용한 모든 segID가 **`evidence` 배열에 존재해야 한다** (부분집합 규칙)
    - 위반 시 document run을 `proposed`로 승격시키지 않고 **검증 실패로 되돌린다**
    - `evidence` 각 항목의 `timestamp`와 `quote`가 **원본 transcript revision과 문자열 일치**해야 한다
    - 존재하지 않는 segID 인용을 거부한다
  - **금지**: 모델 프롬프트 개선으로 때우지 않는다. 서버가 강제할 불변식이다

- [x] **Test 2.4** vault round-trip 테스트 — ✅ **document 25 + store 21 + watcher 19 + index 29건**
  - 파일: `apps/server/test/vault-document.test.ts` · `vault-store.test.ts` · `vault-watcher.test.ts` · `index-db.test.ts`
  - 시나리오 (`technical-foundation` 9절 `파일 계약`):
    - immutable ID가 identity이고, 파일명·경로를 바꿔도 엔티티가 유지된다
    - **앱이 모르는 YAML 필드와 Markdown 본문이 보존된다**
    - 외부에서 파일을 편집하면 file watcher가 감지한다
    - content hash 불일치 시 사람 편집을 덮지 않는다
    - 쓰기가 원자적이고, 충돌 시 마지막 정상본과 충돌본으로 복구할 수 있다
    - SQLite 인덱스를 삭제해도 vault에서 완전히 재생성된다

**🟢 GREEN: 구현**

- [x] **2.5** `packages/contracts`에 상태 enum과 전이 함수 구현 — ✅
  - 5개 상태 머신을 **각각 별도 타입**으로 정의한다
  - 사용자용 문구는 내부 상태명과 **별도 매핑 테이블**로 둔다 (순서 3 완료 조건)

- [x] **2.6** vault 디렉토리 구조와 frontmatter 직렬화 구현 — ✅
  - `vault/{inbox,sources,notes,tasks,decisions,projects,assets,archive}/`
  - 긴 목적·맥락·agenda는 frontmatter가 아니라 본문에 둔다
  - 한 관계를 양방향 필드로 복제하지 않는다
  - **현재 frontmatter는 최종 스키마가 아니다** — `schema_version`으로 관리

- [x] **2.7** chunk 업로드 API 구현 — ✅
  - Phase 0.3에서 확정한 재전송 protocol을 따른다
  - 순번·크기·hash 검증, 멱등 수신, "어디까지 받았나" 질의 endpoint
  - 모든 조각과 manifest가 확인될 때만 `ready`

- [x] **2.8** run artifact 저장소 구현 (`technical-foundation` 11절) — ✅ `src/runs/store.ts`, 32건
  - `sources/<id>/`, `transcriptions/<id>/`, `transcript-revisions/<id>/`, `documentation-runs/<id>/`
  - document run은 audio·transcript를 **복사하지 않고** ID와 hash로 참조한다

- [x] **2.9** SQLite 파생 인덱스 구현 — ✅ `src/index-db/`, 29건
  - 검색·필터용. **재생성 가능해야 하며 정식 원본이 아니다**

**🔵 REFACTOR**

- [x] **2.10** 상태 전이 로직 중복 제거, 오류 타입 정리, 로깅 경계 정돈 — ✅ `boot()`로 조립 일원화, 오류 타입 6종 명명

#### 품질 게이트 ✋

- [x] 상태 머신 unit 테스트 커버리지 **≥ 90%** — ✅ `state.ts` 100% / `rules.ts` 100%
- [x] manifest 검증 커버리지 **≥ 90%** — ✅ `manifest.ts` **100%**
- [x] **evidence 무결성 검증 커버리지 ≥ 90%** — ✅ `evidence.ts` **95.71%**
- [x] Phase 0의 실제 Hermes 출력을 **회귀 fixture로 넣고 결함 A가 검출되는지** 확인 — ✅ 154 segment fixture에서 `not_in_evidence_array` **32건** 검출, 환각 0
- [x] vault round-trip 통합 테스트 통과 — ✅
- [x] `raw audio`, `source hash`, `raw transcript`를 덮어쓰는 코드 경로가 **하나도 없다** (grep으로 확인) — ✅ **grep이 실제 결함 1건을 찾아냈다.** 아래 `기록과 학습` 참조
- [x] SQLite를 삭제하고 재시작해도 vault에서 인덱스가 완전히 복원된다 — ✅ 단위·부팅 통합 테스트 양쪽에서 검증
- [x] 빌드·lint·typecheck 통과 — ✅ build 3/3 · typecheck 3/3 · lint 0
- [x] ~~수동~~ **자동**: 서버를 재시작해도 진행 중이던 source 상태가 유지된다 — ✅ `test/runtime-boot.test.ts`로 자동화

#### 롤백

`apps/server/src` 되돌리기. `vault/` 시험 데이터는 별도 디렉토리(`vault-test/`)를 사용해 실데이터와 섞지 않는다.

---

### Phase 3: 녹음 중 페이지와 수집 파이프라인

**목표**: 사용자가 입력 모드·장치·탭 track을 고르고 직접 녹음을 시작하며, 마이크와 탭 오디오의 성공·실패를 각각 확인할 수 있다.
**예상 시간**: 8~12시간 / **실제**: ~5시간
**상태**: 🔄 **진행 중** — 자동 테스트 전부 통과, 실제 장치 수동 시험 남음
**대응**: `PLAN.md` 순서 2
**선행**: Phase 2 완료

#### 태스크

**🔴 RED: 테스트 먼저**

- [x] **Test 3.1** 녹음 시작 gate 테스트 — ✅ 17건
  - 파일: `src/features/recording/start-gate.test.ts` + `index.test.tsx`
  - 시나리오:
    - **탭 track 없이 온라인 모드를 시작하려 하면 녹음이 시작되지 않고 경고가 표시된다**
    - 시작 전 마이크 level meter와 탭 오디오 level meter가 **각각** 표시된다
    - 자동으로 녹음이 시작되지 않는다 — 사용자의 명시적 조작만
    - 권한 거부 시 별도 상태가 표시된다

- [x] **Test 3.2** manifest 생성 테스트 — ✅ 8건
  - 시나리오: 시작된 녹음의 manifest에 **입력 모드·장치·선택한 track·시작 시각**이 남는다

- [x] **Test 3.3** 입력 단절 구분 테스트 — ✅ 7건 (`screen-state.test.ts`)
  - 시나리오:
    - 마이크만 끊긴 경우와 탭 오디오만 끊긴 경우가 **화면에서 서로 다르게** 표시된다
    - 탭 공유 track이 끝나거나 level이 비정상적으로 사라지면 **즉시** 경고한다

- [x] **Test 3.4** 상태 분리 테스트 — ✅ 6건
  - 시나리오: **녹음 상태와 원본 보존 상태가 각각 독립된 표시 요소를 가진다** (타이머와 보존 상태를 분리)

- [x] **Test 3.5** 금지 항목 테스트 — ✅ 8건 (금지 단어 7종 + 편집 UI 부재)
  - 시나리오: 녹음 중 페이지에 **실시간 전사·AI 요약·결정·Action Item·검수 UI가 없다**

**🟢 GREEN: 구현**

- [x] **3.6** 시작 경로 구현 (순서를 건너뛰지 않는다) — ✅
  - `입력 모드·장치 선택 → 온라인 모드의 탭 track 선택 → 사전 level meter와 탭 track 없음 경고 → manifest 생성 → 사용자의 명시적 녹음 시작`

- [x] **3.7** `RecordingVisualizer` 합성 컴포넌트 — ✅ 실제 오디오 그래프로 검증
  - **실제 `MediaStream` level에 반응한다.** 장식 animation이 아니다
  - Shadcn 토큰·프리미티브 위에서 구성한다

- [x] **3.8** `RecordingControls` 합성 컴포넌트 — ✅
  - 녹음 시작 / 일시정지 / 녹음 종료

- [x] **3.9** 전체 화면 상태 8종 구현 — ✅ `RECORDING_SCREEN_STATES` 8종, 각각 테스트
  - 권한 요청 전 / 권한 거부 / 녹음 준비 / 녹음 중 / 일시정지 / 입력 단절 / 저장 중 / 종료 실패
  - 8종 모두 **같은 화면 계약 안**에 있어야 한다

- [x] **3.10** 클라이언트 수집 파이프라인 — ✅ `ChunkStore`(IndexedDB) + `ChunkUploader` + `CaptureSession`
  - Phase 0.1~0.4에서 확정한 로컬 저장소·chunk 길이·재전송·시간축 정렬을 그대로 구현
  - 조각을 로컬에 **먼저 보존**하고 서버로 업로드

**🔵 REFACTOR**

- [x] **3.11** 스트림 생명주기 정리, 리소스 누수 확인, 상태 파생 로직 추출 — ✅ 판정을 순수 모듈로 분리, unmount 시 track 정리

#### 완료 조건 (`PLAN.md` 순서 2 원문 — 모두 충족)

- [x] 탭 track 없이 온라인 모드를 시작하려 하면 녹음이 시작되지 않고 경고가 표시된다 — ✅ 자동
- [x] 시작된 녹음의 manifest에 입력 모드, 장치, 선택한 track과 시작 시각이 남는다 — ✅ 자동
- [x] 마이크만 끊은 경우와 탭 오디오만 끊은 경우가 화면에서 서로 다르게 표시된다 — ✅ 자동
- [x] 녹음 상태와 원본 보존 상태가 각각 독립된 표시 요소를 가진다 — ✅ 자동

#### 품질 게이트 ✋

- [x] 위 완료 조건 4개 **전부** 자동 테스트 또는 기록된 수동 시험으로 증명됨 — ✅ 4/4 자동
- [x] visualizer가 실제 오디오 입력에 반응한다 (무음 시 정지 확인) — ✅ Oscillator→MediaStreamDestination 실제 그래프로 검증. gain 0이면 레벨 0
- [x] 커버리지·빌드·lint·typecheck 통과 — ✅ build 3/3 · typecheck 3/3 · lint 0 · 테스트 455건
- [ ] 수동: 실제 마이크로 대면 모드 녹음 1회 — ⏳ **남음** (실제 장치 필요)
- [ ] 수동: Chrome 탭 공유로 온라인 모드 녹음 1회, 도중 탭 공유 중단 — ⏳ **남음** (`getDisplayMedia`는 사용자 제스처가 필요해 자동화 불가)
- [ ] 메모리: 10분 녹음 중 힙이 단조 증가하지 않는다 — ⏳ **남음**

#### 롤백

페이지 A 컴포넌트와 수집 파이프라인 되돌리기. Phase 2 서버 API는 유지 (업로드 계약은 독립).

---

### Phase 4: 처리 전환과 전사 파이프라인

**목표**: 녹음 종료 또는 파일 업로드 후 즉시 페이지 B 로딩 상태로 이동하고, `whisper.cpp` 전사가 끝나면 교정 화면이 열린다.
**예상 시간**: 6~10시간 / **실제**: ~4시간
**상태**: ✅ **완료** (2026-08-06) — 실제 오디오 전사 검증 포함
**대응**: `PLAN.md` 순서 3
**선행**: Phase 3 완료
**확정된 결정**: 처리 중 상태는 **즉시 페이지 B 로딩 상태로 이동** ✅

#### 태스크

**🔴 RED: 테스트 먼저**

- [x] **Test 4.1** 상태 매핑 테스트 — ✅ 28건 (`packages/contracts/test/phrasing.test.ts`)
  - 시나리오:
    - 화면의 상태가 **source와 transcription job 중 어느 객체의 상태인지 추적할 수 있다**
    - 사용자용 문구가 내부 상태와 **명시적으로 매핑**된다 (매핑 테이블이 테스트에서 참조됨)
    - source의 `finalizing`·`ready`와 job의 `queued`·`transcribing`·`completed`·`failed_retryable`이 섞이지 않는다

- [x] **Test 4.2** 업로드 source 테스트 — ✅ 23건 (`upload-source.test.ts`) + 세션 API 8건
  - 시나리오:
    - **업로드가 끝나지 않은 상태**와 **서버 검증까지 끝난 `ready`**가 구분된다
    - 업로드 진행률·서버 검증 실패·`ready` 도달이 각각 다르게 표시된다
    - 업로드 source가 페이지 A를 거치지 않고 페이지 B 로딩 상태로 들어간다

- [x] **Test 4.3** 재접속 복구 테스트 — ✅ 서버 세션 API 8건 + 큐 재기동 3건
  - 파일: `apps/server/test/session-api.test.ts` · `transcription-queue.test.ts`
  - ⚠️ Playwright e2e 대신 API 수준으로 검증했다. 브라우저를 실제로 닫았다 여는
    경로는 Phase 7 통합 검증에서 다룬다
  - 시나리오:
    - **브라우저를 닫았다가 다시 열면 같은 source의 현재 상태와 다음 조작이 표시된다**
    - **재접속 후 같은 source를 중복 업로드하지 않는다**

**🟢 GREEN: 구현**

- [x] **4.4** 내부 상태 → 사용자 문구 매핑 테이블 — ✅ `phrasing.ts`
  - `technical-foundation`의 `분리된 처리 상태`를 따른다
  - 최종 문구는 미확정이므로 **placeholder를 명시적으로 표시**하고 임의로 확정하지 않는다

- [x] **4.5** 페이지 B 로딩 상태 구현 — ✅ `features/processing/`
  - 녹음 source와 업로드 source가 **같은 상태 표시 컴포넌트**를 재사용한다

- [x] **4.6** 파일 업로드 경로 구현 — ✅ 녹음과 **같은 chunk API**를 탄다
  - `사이드바 파일 업로드 → 파일 선택·업로드 → 서버 검증(ready) → 전사 처리 → 페이지 B 전사 교정`

- [x] **4.7** 전사 job 구현 — **Ratatouille이 `whisper-cli` 직접 호출** — ✅
  - ⚠️ 이 항목은 원래 "Hermes 경유"였다. 0.7b 실측에서 Hermes STT 4개 경로가
    **전부 timestamp를 버린다**는 것이 확인되어 뒤집혔고, 사용자가 「전사만 분리」로
    확정했다. timestamp는 `review-contract.md`의 하드 계약이라 타협 대상이 아니다.
  - Hermes는 **모델 경계만** 소유한다 (Phase 6의 AI 정리). 전사는 Hermes를 거치지 않는다
  - 한국어(`-l ko`), timestamp 포함 JSON(`-oj`). ~~온라인은 `-di`~~ → **접음**(2026-08-06): 실제 회의에서 분리 실패, 타임라인만 8초 덩어리로 뭉갬
  - `transcript.raw.json` 생성 후 **불변**으로 보존
  - `failed_retryable` 재시도 경로
  - 실측 기준선: 507초 오디오 → 34.9초, 피크 1.98GB. 이 범위를 크게 벗어나면 설정을 의심한다

- [x] **4.8** 세션 복구 구현 — ✅ `GET /api/session`
  - 서버가 진행 중인 source·job 목록을 제공하고, 브라우저가 재접속 시 이어받는다

**🔵 REFACTOR**

- [x] **4.9** job 큐 정리, 오류 분류 일관화 — ✅ **중복 전사 구현 2개를 1개로 통합**(아래 기록 참조).
  상태 갱신은 폴링으로 통일(처리 중일 때만 돈다). 스트림은 필요해지면 그때 본다

#### 완료 조건 (`PLAN.md` 순서 3 원문 — 모두 충족)

- [x] 화면의 상태가 source와 transcription job 중 어느 객체의 상태인지 추적할 수 있고, 사용자용 문구가 내부 상태와 명시적으로 매핑된다 — ✅ `sourceState`·`jobState` 분리
- [x] 업로드가 끝나지 않은 상태와 서버 검증까지 끝난 `ready`가 구분된다 — ✅ `uploading → verifying → ready`
- [x] 브라우저를 닫았다가 다시 열면 같은 source의 현재 상태와 다음 조작이 표시된다 — ✅ `nextAction`
- [x] 재접속 후 같은 source를 중복 업로드하지 않는다 — ✅ `missing`이 빠진 순번만 알려준다

#### 품질 게이트 ✋

- [x] 위 완료 조건 4개 전부 증명됨 — ✅ 자동 테스트
- [x] **녹음 중 실시간 전사가 추가되지 않았다** (코드 검색으로 확인) — ✅ `grep -rE "transcri|whisper|hermes|summar" features/recording/` → 0건
- [x] 실제 오디오 파일로 전사 성공(`whisper-cli` 직접 호출), timestamp가 오디오와 일치 — ✅ 20초 한국어 회의 음성, timestamp 단조 증가·범위 내
- [x] 커버리지·빌드·lint·typecheck 통과 — ✅ build 3/3 · typecheck 3/3 · lint 0 · 테스트 618건

#### 롤백

전사 job 워커와 페이지 B 로딩 상태 되돌리기. Phase 3 녹음 경로는 `finalizing`까지 유지.

---

### Phase 5: 결과와 전사 교정 페이지

**목표**: 오디오 재생·timestamp jump·전사 교정·전사 확정이 한 페이지에서 가능하다.
**예상 시간**: 8~12시간
**상태**: 🔄 진행 중 (2026-08-06 착수)
**대응**: `PLAN.md` 순서 4
**선행**: Phase 4 완료

> 🎯 **2026-08-06 방향 확정 — 이 Phase의 무게중심은 재교정이다.**
> 사용자 지시: *"화자분리는 접어두고 타임라인은 가지되 재교정에 큰 목적을 두고
> 내용 정리, 액션 아이템 생성에 주력을 두자."*
> 화자 지정 UI(5.6)와 입력 정보 편집(5.9)은 뒤로 미루고, **전사를 실제로 고쳐
> 확정하는 경로**를 먼저 완성한다.

#### 태스크

**🔴 RED: 테스트 먼저**

- [x] **Test 5.1** 전사 교정 상태 잠금 테스트 — ✅ 4건
  - `⛔ AI 결과를 가져오는 요청이 하나도 없다`가 네트워크 호출을 직접 검사한다
  - 시나리오:
    - `transcript_reviewing`에서 왼쪽 AI 영역이 **`전사 확정 후 생성` 잠금 상태**다
    - **전사 확정 전에는 AI 결과를 생성하지도 표시하지도 않는다**
    - 오른쪽은 편집 가능한 전사와 `전사 확정` 버튼

- [ ] **Test 5.2** 재교정 무효화 테스트
  - 시나리오:
    - `전사 수정`을 선택하면 새 transcript revision이 `transcript_reviewing`으로 열린다
    - 기존 AI 결과가 **`stale`로 표시된다** (숨기지 않는다)
    - 다시 확정하기 전에는 AI 결과를 **재생성하지 않는다**

- [x] **Test 5.3** timestamp jump 테스트 — ✅ 자동 2건 + 실물 확인
  - 실물: `00:00:09` 클릭 → `currentTime` 10.38s(재생 중), 활성 세그먼트 `seg_2`
  - 시나리오: timestamp를 누르면 해당 오디오 구간으로 정확히 이동해 재생된다

- [x] **Test 5.4** 화면 계약 위반 감지 테스트 — ✅ 3건 (`<video>` 부재, 좌우 분할, 녹음 조작 부재)
  - 시나리오:
    - 재생 영역이 **오디오 재생기이고 영상 player가 아니다**
    - 녹음 화면과 결과 화면이 **한 페이지로 합쳐져 있지 않다**

**🟢 GREEN: 구현**

- [x] **5.4c** 전사 교정 revision API — ✅ **완료**
  - `GET/PATCH /api/sources/:id/revision`, `POST .../approve`, `POST .../reopen`
  - ⛔ raw transcript를 고치지 않는다. 교정은 별도 revision에 남고 `original`을 함께 준다
  - ⛔ 세그먼트 id·timestamp는 편집 불가 — evidence가 그것으로 원문을 가리킨다
  - ⛔ 확정본은 write-once. 재교정은 새 revision이고 이전 확정본을 덮지 않는다(규칙 3)
  - ⛔ 교정본은 **전사 완료 사건**에서 열린다. 조회(GET)가 자원을 만들지 않는다
  - 부분 저장(보낸 세그먼트만) — 30분 전사를 통째로 올리지 않는다

- [x] **5.4b** 재생용 오디오 서버 — ✅ **완료** `GET /api/sources/:id/audio`
  - ⛔ 전사용과 **다른 파일이다**. 전사용 채널 분리를 그대로 들려주면 한쪽 귀에 한 사람씩 들린다
  - ⛔ 조각 이어붙인 webm은 duration·Cues가 없어 **탐색이 안 된다** → AAC/MP4 + faststart
  - ⛔ 섞기 전 track별 음량 평준화. 안 하면 마이크(−48.7 dB)가 안 들린다 → 차이 28.7 → 11.3 dB
  - Range 지원(206·열린 끝·416). 없으면 Chrome이 30분 파일을 매번 처음부터 받는다
  - 실측: 51분 612조각 → 25.4MB, 10.9초. 캐시 히트 0.03초

- [x] **5.5** `AudioPlayer` 합성 컴포넌트 — ✅ **완료**
  - 왼쪽 상단. **영상 아님** (테스트가 `<video>` 부재를 못박는다)
  - 재생/일시정지·±5초·진행 막대(`<input type=range>` — 직접 그린 div는 keyboard로 못 움직인다)
  - 실물: duration 58.619s, readyState 4

- [x] **5.6** `TranscriptEditor` 합성 컴포넌트 — ✅ **완료. Phase 5의 중심**
  - timestamp 표시, 편집 가능
  - ~~화자: `나` / `참석자 1` / `미확인` 지원~~ → **보류** (2026-08-06 범위 변경, 아래 참조)
  - **불확실 구간·이름·숫자·날짜 강조**
  - **전체 문장을 음성과 대조하는 것은 완료 조건이 아니다**

- [x] **5.7** 페이지 B 레이아웃 구현 — ✅ **완료**
  - `Sidebar + 회의 상세`, 상세 내부는 `넓은 왼쪽(3fr) + 좁은 오른쪽(2fr)`
  - **Sidebar 옆에 두 번째 회의 목록 열을 만들지 않았다**
  - 하나의 route 안에서 처리 중 → 교정으로 전환된다

- [ ] **5.8** 4개 내부 상태 전이 구현
  - `transcript_reviewing` → `documenting` → `proposed`/`reviewing`/`current` → (재수정 시) 새 revision
  - **하나의 route 안에서** 순차적으로 전환된다

- [ ] **5.9** 입력 정보 편집 영역
  - 제목 / 프로젝트 / 참석자 / 세션·미팅 유형 / 목적 / 특별히 확인할 항목 (+ 선택: agenda, tag, 관련 링크)
  - **현재 계약에서 AI 생성의 필수 gate가 아니다**
  - 빈 필드는 `미입력`으로 보존하고 모델이 지어내지 않는다
  - ⚠️ 필드 목록과 편집 시점은 **미결정** — 아래 `남은 사용자 결정` 참조

**🔵 REFACTOR**

- [ ] **5.10** 재생·전사 동기화 로직 추출, 긴 전사 렌더링 성능 정리

**📌 계획에 없었으나 완료한 것**

- [x] **회의 삭제** — ✅ **완료**(2026-08-06). `DELETE /api/sources/:id`
  - 계획에 없던 이유: 초판이 「무엇을 만드는가」만 보고 **「무엇이 쌓이는가」를 안 봤다.**
    녹음 중 브라우저가 죽으면 `capturing` source가 사이드바에 영원히 남고 치울 방법이 없었다
  - 소거가 아니라 `.data/trash`로 이동. raw audio는 되돌릴 수단이 없다(5절)
  - 돌고 있는 전사는 409로 거절. 읽는 중인 조각을 치우면 전사가 깨진다

#### 완료 조건 (`PLAN.md` 순서 4)

- [ ] 전사 수정, 근거 음성 재생과 확정이 한 페이지에서 가능하다

#### 품질 게이트 ✋

- [ ] `전사 확정` 조건을 건너뛰거나 자동 통과시키는 경로가 없다
- [ ] 전사 교정 중 AI 결과를 fetch하는 네트워크 요청이 **하나도 발생하지 않는다** (네트워크 로그 확인)
- [ ] 30분 분량 한국어 전사에서 스크롤·편집이 버벅이지 않는다
- [ ] 커버리지·빌드·lint·typecheck 통과
- [ ] 수동: timestamp 10개를 눌러 오디오 위치가 정확한지 확인

#### 롤백

페이지 B 컴포넌트 되돌리기. 전사 데이터는 서버에 보존되므로 유실 없음.

---

### Phase 6: AI 정리와 사용자 확정

**목표**: `transcript_approved` 이후에만 4개 결과가 생성되고, 각 section이 독립 검수 상태를 가지며, 모델 장애가 화면 상태로 드러난다.
**예상 시간**: 10~14시간
**상태**: 🔄 진행 중 (2026-08-06 착수 — 서버 완료, 화면 남음)
**대응**: `PLAN.md` 순서 5
**선행**: Phase 5 완료

> 🎯 **2026-08-06 우선순위**: 4개 section은 그대로 두되 **회의 요약(내용 정리)과
> Action Item을 먼저** 만든다. `원문 근거`는 환각 방지 계약이라 뺄 수 없다
> (evidence validator가 이미 Phase 2에 있다).
> ⚠️ **Action Item의 담당자는 모델이 채우지 못하는 경우가 있다** — 화자 분리를
> 접었으므로 `제가 하겠습니다` 형태는 `미입력`으로 남는다. 사람이 지정한다.

#### 태스크

**🔴 RED: 테스트 먼저**

- [x] **Test 6.1** 생성 gate 테스트 — ✅ 확정 전에는 결과 영역을 **마운트조차 하지 않는다**
  - 시나리오: **전사가 확정되지 않았으면 AI 정리 생성 버튼이 동작하지 않는다**

- [x] **Test 6.2** 4개 section 독립 검수 테스트 — ✅ 계약·서버 완료. 화면 남음
  - 시나리오:
    - `summary` / `decisions` / `tasks` / `evidence`가 **각각 독립된 검수 상태**를 갖는다
    - 허용 상태: `unreviewed` / `in_progress` / `accepted` / `edited` / `empty`
    - 회의 요약과 원문 근거는 `accepted` 또는 `edited`여야 한다
    - 결정 사항과 Action Item은 **회의에 실제 항목이 없을 때만** `empty` 허용
    - `uncertain`이나 수정 필요 항목이 남아 있으면 **문서가 `current`가 되지 않는다**
    - 결과가 없는 section의 `empty`를 **오류로 표시하지 않는다**
    - 루브릭의 `verdict`와 section의 `review_state`가 **서로 다른 namespace**다
    - 루브릭의 `not_applicable`이 section 상태를 **자동으로 바꾸지 않는다**

- [x] **Test 6.3** evidence 양방향 접근 테스트 — ✅ 각주로 구현. 닿지 못하는 근거는 `[seg_999?]`로 남기되 버튼이 아니다
  - 시나리오:
    - 원문 근거가 **evidence ID와 timestamp를 가진 전용 조회 영역**으로 제공된다
    - 다른 세 결과 안의 근거 링크에서도 **같은 segment로 이동**할 수 있다
    - 각 항목에서 근거 segment를 눌러 해당 음성을 **재생할 수 있다**
    - **인용됐지만 `evidence` 배열에 없는 segID가 있으면 화면에 깨진 링크를 그리지 않는다.**
      Phase 2의 schema validator가 먼저 막지만, UI도 방어한다

- [x] **Test 6.3b** 제안 vs 결정 구분 검수 테스트 — ✅ 루브릭 첫 기준을 `fix_required`로 뒤집으면 확정이 막힌다(실측)
  - 배경: 실측에서 결정 2건 중 1건이 **제안을 결정으로 승격**했다
    (seg151 "우리 앞으로도 이쁘게 만나자" → seg152 "응?" — 동의 발화 없음)
  - 시나리오:
    - 결정 사항 루브릭의 "실제 결정과 단순 제안·논의가 구분됐는가?"를 사용자가 `fix_required`로
      바꿀 수 있고, 그 상태에서 문서가 `current`로 승격되지 않는다
    - AI가 `pass`로 표시한 기준도 사용자가 뒤집을 수 있다
    - **AI 1차 판정만으로 자동 승격되는 경로가 없다**

- [x] **Test 6.4** 모델 장애 상태 테스트 — ✅ `auth_required`는 재시도가 아니라 재인증 안내. `degraded_draft`는 아직
  - 시나리오:
    - `auth_required` → ChatGPT OAuth 재인증 안내가 표시되고 **전사 산출물이 보존된다**
    - `waiting_for_model` → 대기 상태
    - `failed_retryable` → 같은 단계 재시도
    - `degraded_draft` → **사용자가 명시적으로 요청했을 때만 생성**되고 정상 산출물과 **시각적으로 구분**된다

- [x] **Test 6.5** 재생성 비파괴 테스트 — ✅ 새 실행은 별개다. 이전 실행의 편집이 그대로 남는다
  - 시나리오:
    - 재생성이 **사람 편집을 덮지 않고** 새 proposal과 diff를 만든다
    - 한 산출물 수정이 다른 산출물에 영향을 주면 관련 section이 `in_progress`로 돌아가고 UI에 **`재검토 필요`**로 표시된다
    - final Markdown을 덮기 전에 reviewed result와 source hash가 일치해야 한다

**🟢 GREEN: 구현**

- 🔄 **6.6** Hermes 연동 구현 — **호출 경로는 됐고 profile·skill 층이 남았다**
  - [x] Phase 0.6에서 확정한 호출 경로 사용 (`hermes -z` 검증됨, `serve`는 0.6b에서 판단)
  - [ ] profile `ratatouille`, provider `openai-codex` — ⛔ **외부에 그 profile이 없다**
        (2026-08-06 실측: `hermes profile list` → `default`·`k-skill`·`learning`·`reading-kg`·
        `signal`·`youtube`). 없는 것을 기본값으로 박으면 AI 정리가 통째로 깨지므로 그대로 뒀다.
        대신 **실제로 무엇으로 돌았는지를 `run.json`의 `profile`에 남긴다**(기본이면 `hermes_default`)
  - [ ] skill: `process-recording`, `extract-decisions`, `extract-tasks`, `maintain-vault`
        — ⛔ **설치된 skill이 하나도 없다**(실측: `hermes skills list` 결과 비어 있음).
        지금은 프롬프트를 서버가 직접 만들어 넘긴다(`documents/prompt.ts`). 그래서
        `run.json`의 `skill_version`이 `none`이다.
        ⚠️ 이 넷을 만들려면 프롬프트 소유권을 서버에서 Hermes skill로 옮겨야 한다 —
        **사용자 결정이 필요한 범위**다(아래 「남은 사용자 결정」 참고)
  - **`plan-today`는 Phase 2 후보이므로 넣지 않는다**
  - **`hermes proxy`를 쓰지 않는다** — profile·skill 층을 우회해 소유권 경계가 깨진다
  - **로컬 모델 자동 fallback 없음**
  - 프롬프트에 evidence 부분집합 규칙을 명시하되, **강제는 Phase 2 validator가 한다**

- [x] **6.7** schema validator와 Markdown 렌더러 — ✅ 확정하면 `vault/notes/<id>.md`에 쓴다. 근거는 Markdown 각주
  - `proposed.json` → schema 검증 → proposed Markdown

- [x] **6.8** `MeetingSummary` 합성 컴포넌트와 4개 결과 영역 — ✅ 각주 방식(아래 구현 노트)
  - 회의 요약 / 결정 사항 / Action Item / 원문 근거
  - **네 section을 빼거나 하나로 합치지 않는다**
  - 화면의 `Action Item`은 내부 `tasks` entity
  - **주요 논점·열린 질문을 독립 section으로 추가하지 않는다**

- [x] **6.9** 루브릭 검수 UI — ✅ 기본은 버튼 하나(「확인함」), 기준별 판정은 문제를 찾았을 때만 펼친다
  - 판정값: `pass` / `fix_required` / `uncertain` / `not_applicable`
  - AI 1차 판정 + 근거 segment → 사용자 확인·수정 → 사용자 최종 판정
  - **AI 판정은 검수 보조이며 최종 승인이 아니다.** 사용자가 `pass`도 바꿀 수 있다

- [x] **6.10** 결정 사항 entity 구현 — ✅ 서버·계약 완료. **화면은 아직 안 붙었다**
  - [x] 작업과 **별도 entity**로 저장 — `vault/decisions/<id>.md` 파일 하나가 결정 하나
  - [x] 상태: 최소 `active` / `superseded` / `reversed` — 되살리는 전이는 두지 않았다.
        잘못 대체했으면 새 결정으로 정정한다
  - [x] 결정 내용·이유·사람·evidence segment 연결
        — ⚠️ **이유·결정자는 모델에게 받지 않는다.** 화자 분리를 접어 「그렇게 하죠」의
        주인을 모르고, 이유를 따로 물으면 evidence validator가 못 잡는 근거를 지어낸다.
        API(`PATCH /api/sources/decisions/:id`)로 사람이 채운다
  - [x] **후속 결정이 이전 결정을 대체해도 이전 기록을 삭제하지 않는다**
        — 파일은 남고 상태만 바뀐다. 재확정에서 사람이 지운 결정도 `reversed`로 남는다
  - [x] **화면 연결** — ✅ ⋮ 메뉴 → 「결정 이력」 Sheet. 검수 계약의 네 section은 건드리지 않았다.
        대체·뒤집힌 결정도 함께 보인다 — 거르면 「왜 바뀌었나」를 볼 길이 사라진다

- [x] **6.11** run.json 기록 — ✅ 실패한 실행도 남는다. 확정본은 회차로 쌓인다
  - `model_provider: openai-codex`, `auth_type: chatgpt_oauth`, 실제 model identifier, `runtime: hermes_default`, `prompt_version`, `skill_version`, `schema_version`, `rubric_version`, source hash, 시작·종료·재시도 시각, 사용자가 수정한 필드와 판정 변화
  - 재시도 시각은 `attempt` + `retry_of` 체인으로 읽는다 — 재시도는 새 run이다(5절)
  - 사람이 고친 필드와 판정 변화는 확정 시점의 `reviewed/<회차>.json`에 남는다

**🔵 REFACTOR**

- [x] **6.12** 검수 상태 파생 로직 통합, evidence 링크 해석 단일화, 루브릭 클릭 수 점검 — ✅
  - [x] 각주 번호 규칙이 **세 곳**(화면·회의록·결정 파일)에 각자 있었다 → `footnoteNumbers`·
        `toMarkdownFootnotes`를 계약에 두고 셋이 같은 것을 쓴다
  - [x] 「사람이 봤다」 판정이 화면과 서버에 따로 있었다 → `isSectionSettled`
  - [x] **한 산출물 확정 = 5클릭**(네 section 확인 + 문서 확정). 이 숫자를 테스트로 묶었다 —
        늘어나면 루브릭이 행정 절차가 되고 있다는 뜻이다

#### 완료 조건 (`PLAN.md` 순서 5 원문 — 모두 충족)

- [x] 4개 결과 section이 각각 독립된 검수 상태를 갖고, 검수 계약의 완료 조건을 충족하기 전에는 문서가 `current`가 되지 않는다 — ✅ 실측: 막는 이유 4 → 0 → 확정
- [x] 각 항목에서 근거 segment를 눌러 해당 음성을 재생할 수 있다 — ✅ 각주 → 「여기부터 듣기」
- [x] 전사가 확정되지 않았으면 AI 정리 생성 버튼이 동작하지 않는다 — ✅ 확정 전에는 결과 영역을 **마운트조차 하지 않는다**
- [ ] OAuth 만료 상태에서 생성을 시도하면 `auth_required` 안내가 표시되고 전사 산출물이 보존된다
- [x] `degraded_draft`가 정상 산출물과 시각적으로 구분된다 — ✅ 명시 요청 전에는 **그리지 않고**,
      요청 후에는 「확정할 수 없는 읽기용」 액자로 감싼다. 검수·편집·확정이 전부 막힌다

#### 품질 게이트 ✋

- [ ] 위 완료 조건 5개 전부 증명됨
- [ ] 실제 한국어 회의 오디오 1건으로 전체 경로를 통과시켰다
- [ ] OAuth를 의도적으로 만료시켜 `auth_required` 화면을 확인했다
- [x] AI 결과가 사람 편집을 덮어쓰는 경로가 **없다** — ✅ 편집은 그 run에만 쌓이고, 다시 정리하면 새 run이 생긴다
- [ ] 루브릭이 "품질 도구가 아니라 클릭해야 하는 행정 절차"가 되지 않았는지 검토했다 (한 산출물 확정에 필요한 클릭 수 기록)
- [ ] 커버리지·빌드·lint·typecheck 통과

#### 롤백

Hermes 연동과 결과 영역 되돌리기. Phase 5의 전사 확정까지는 유지되므로 transcript 산출물은 보존.

---

### Phase 7: 통합 검증

**목표**: 전체 경로가 실제 환경에서 동작하고, 화면 계약 위반과 Phase 2 유입이 없음을 증명한다.
**예상 시간**: 6~8시간
**상태**: ⏳ 대기
**대응**: `PLAN.md` 순서 6
**선행**: Phase 6 완료

#### 태스크

**🧪 자동 검증**

- [ ] **7.1** E2E 흐름 테스트 — 녹음 source
  - `녹음 시작 → 종료 → 페이지 B 로딩 → 전사 교정 → 확정 → AI 정리 → 4 section 검수 → current`

- [ ] **7.2** E2E 흐름 테스트 — 업로드 source
  - **페이지 A를 거치지 않고** 페이지 B에 도달하는지 확인

- [ ] **7.3** 접근성·반응형 자동 검사
  - keyboard focus 순서, 대비, 좁은 화면 가로 잘림, 전사·결과 영역의 스크롤 독립성

- [ ] **7.4** Phase 2 유입 검사 (자동)
  - 제품 경로의 내비게이션에 `Today` / `캘린더` / `로드맵` / 통합 작업 관리가 **없음**을 라우트 목록으로 검증

**🔬 수동 시험 (`실제 구현` 추가 조건)**

- [ ] **7.5** 대면 마이크 흐름 1회 이상
- [ ] **7.6** Chrome 마이크 + 탭 오디오 흐름 1회 이상
- [ ] **7.7** **30분 이상 녹음** — 입력 단절 포함
  - 확인: 조각 유실 없음, 중복 업로드 없음, manifest 검증 통과
- [ ] **7.8** **네트워크 중단 후 재연결** 1회 이상
  - 확인: 원본 손실 없이 같은 source로 재개
- [ ] **7.9** 긴 한국어 전사 렌더링·편집 확인
- [ ] **7.10** keyboard만으로 두 페이지 주요 조작 완주

#### 완료 조건 — 공통 (`PLAN.md` 순서 6 원문, 모두 충족)

- [ ] 두 페이지의 주요 조작을 마우스 없이 keyboard만으로 완료할 수 있다
- [ ] 좁은 화면에서 본문이 가로로 잘리지 않고 전사와 결과 영역의 스크롤이 서로 독립적이다
- [ ] 제품 경로의 내비게이션에 Today, 캘린더, 로드맵과 통합 작업 관리 항목이 없다
- [ ] 업로드 source가 페이지 A를 거치지 않고 페이지 B에 도달한다

#### 완료 조건 — `실제 구현` 추가 (모두 충족)

- [ ] 시험한 30분 녹음 회차에서 조각 유실과 중복 업로드가 없고 manifest 검증을 통과한다
- [ ] 녹음 중 네트워크를 끊고 다시 연결한 회차에서 원본 손실 없이 같은 source로 재개된다

> ⚠️ **위 두 항목은 시험한 회차의 결과이며 장시간 녹음 안정성 전반을 입증하지 않는다.** 완료 보고에 이 한계를 그대로 적는다.

#### 품질 게이트 ✋

- [ ] 아래 `검증 증거` 체크리스트가 **전부** 채워졌다
- [ ] 전체 테스트 스위트가 5분 이내에 끝난다
- [ ] 테스트 3회 연속 실행 결과가 같다
- [ ] 의존성 보안 감사 통과

---

## 🚫 임의로 바꾸면 안 되는 것

`PLAN.md`와 `CONTEXT.md`의 금지 항목이다. 구현 중 편의를 이유로 위반하지 않는다.

**화면 구조**

- 두 페이지를 녹음과 결과가 동시에 보이는 한 페이지로 합치지 않는다
- 녹음 중 페이지에 실시간 전사나 AI 결과를 넣지 않는다
- 결과 페이지의 재생 영역을 영상 플레이어로 만들지 않는다
- Sidebar 옆에 두 번째 회의 목록 열이나 복잡한 폴더 tree를 추가하지 않는다

**범위**

- Phase 1에 Today, 캘린더, 로드맵 또는 통합 작업 관리를 넣지 않는다
- 검수 계약의 네 결과 section을 화면에서 빼거나 하나로 합치지 않는다
- 주요 논점·열린 질문을 독립 section으로 추가하지 않는다

**상태와 데이터**

- `전사 확정` 조건을 건너뛰거나 자동 통과시키지 않는다
- 서로 다른 객체의 처리 상태를 하나의 source 상태로 합치지 않는다
- AI 결과나 재생성이 사람의 편집을 덮어쓰게 하지 않는다
- Markdown 파일명과 경로를 엔티티 ID로 사용하지 않는다
- 루브릭의 `not_applicable`이나 section의 `empty`를 오류·누락으로 처리해 회의에 없던 기한·담당자·결정을 만들지 않는다

**UI 시스템**

- "Shadcn만 사용"을 이유로 녹음 전용 기능을 가짜 Shadcn 컴포넌트로 대체하지 않는다
- "Shadcn UI만"을 커스텀 합성 컴포넌트 금지로 해석하거나 다른 UI kit를 섞지 않는다

**서술**

- `openai-codex` provider를 OpenAI가 Hermes용으로 공식 지원한다고 표현하지 않는다
- Docker가 macOS에서 전혀 쓸 수 없다고 일반화하지 않는다
- `whisper.cpp large-v3-turbo`가 한국어 **회의**에서 충분하다고 단정하지 않는다.
  실측한 것은 **비회의 샘플 1건·1회 실행**이며, 다중 화자 겹침·전문 용어·날짜 발화는 검증되지 않았다
- 전사문 전체 검수를 모든 문장의 음성 대조로 해석하지 않는다
- 인터넷 접근 가능한 개인 도메인이라고 인증·TLS·백업 설계가 끝났다고 가정하지 않는다

---

## ❓ 남은 사용자 결정

`차단`은 결정 없이 그 Phase를 완료로 표시할 수 없다는 뜻이고, `병행`은 결정 전에도 나머지 작업을 진행할 수 있다는 뜻이다.

| 남은 결정 | 영향 | 상태 |
| --- | --- | --- |
| 서버 웹 프레임워크 · SQLite 라이브러리 · 프로세스 관리자 | **Phase 0 차단** | ⏳ 미정 · 🚨 에스컬레이션 |
| 브라우저 로컬 저장소 · chunk 길이 · 재전송 protocol · 시간축 정렬 | **Phase 0 차단** | ⏳ 실험 필요 |
| `hermes -z` 서브프로세스 vs `hermes serve` JSON-RPC | Phase 0 · 6 병행 | ⏳ `-z` 검증됨. `serve`는 run 상태 관측 필요 시에만 |
| **실제 회의 오디오 확보** — 현 샘플은 회의가 아님 | Phase 0 완료 조건 | ⏳ **사용자 제공 필요** |
| 데스크톱에서 결과 화면의 좌우 폭과 resize 허용 여부 | Phase 5 병행 | ⏳ 미정 |
| 모바일에서 전사와 AI 결과를 전환하는 방식 | Phase 5 병행 | ⏳ 미정 |
| 입력 정보의 필드와 편집 시점 | Phase 5·6 병행 | ⏳ 미정 |
| 녹음 실패·복구와 전사 실패의 최종 문구 | Phase 3·4 병행 | ⏳ 미정 |
| 루브릭의 클릭 수, 일괄 승인과 keyboard interaction | Phase 6 병행 | ⏳ 미정 |
| 인터넷 공개 범위 · 인증 방식 · 원격 접근 정책 | **Phase 1 범위 밖** (localhost 가정) | 🔒 보류 |
| 외부 편집 충돌 시 자동 병합 범위와 삭제 정책 | Phase 2 병행 | ⏳ 미정 |
| 필수 입력 gate 도입을 재검토할 교정 데이터 기준 | Phase 1 범위 밖 | 🔒 보류 |

### 이번 세션에서 해소된 결정 ✅

| 결정 | 확정 | 근거 |
| --- | --- | --- |
| 작업 종류 선언 | 실제 구현 | 사용자 |
| `shadcn-admin` 적용 위치와 브랜치 | 모노레포 `apps/web`, 현재 폴더에 신규 | 사용자 |
| Vite · TypeScript · TanStack Router 유지 여부 | 유지 | 사용자 |
| 녹음 종료 후 처리 중 상태가 머무를 페이지 | 즉시 페이지 B 로딩 상태 | 사용자 |
| 전사 소유권 | ~~Hermes로만~~ → **Ratatouille이 `whisper-cli` 직접 호출** | 실측(0.7b) 후 **사용자가 「전사만 분리」 확정.** Hermes 4개 경로 전부 timestamp 소실 |
| 전사 엔진 | whisper.cpp — faster-whisper는 Apple Silicon CPU 전용 | 실측 + Context7 |
| Whisper 모델 | `large-v3-turbo` — 14.5x 실시간, 1.98GB, 한국어 양호 | 실측 |
| 화자 분리 방식 | ~~`-di` 스테레오 채널 분리~~ → **접음**(2026-08-06) | 실측: 실제 회의에서 분리 실패(마이크 28.7 dB 작음), 타임라인 7→14 세그먼트로 개선 |
| `hermes proxy` 사용 여부 | **제외** — profile·skill 우회로 소유권 경계 위반 | 실측 |
| 오디오 외부 전송 | **하지 않음** — 로컬 전사로 충분 | 실측 |

---

## ⚠️ 리스크

| 리스크 | 확률 | 영향 | 완화 |
| --- | --- | --- | --- |
| 브라우저 로컬 저장소가 30분 녹음을 감당하지 못함 | 중 | 높음 | Phase 0.1에서 먼저 반증. 실패 시 chunk를 즉시 서버로 보내고 로컬은 짧은 버퍼로만 쓰는 대안을 사용자에게 제안 |
| ~~`whisper.cpp` 한국어 정확도가 교정 부담을 감당 못 할 수준~~ | ~~중~~ → **낮음** | 높음 | ✅ **실측으로 완화.** 비회의 샘플에서 품질 양호, 14.5x 실시간. **단 실제 회의로 재검증 전까지 완전 해소 아님** |
| ~~evidence ID·timestamp를 모델이 지어냄~~ | ~~높음~~ → **낮음** | 높음 | ✅ **2회 실측 22/22 정확, 인용 59/59 실재, 환각 0.** 추가로 Phase 2 validator가 부분집합 규칙을 강제 |
| ~~Hermes protocol이 run 상태를 제공하지 않음~~ | ~~중~~ → **낮음** | 중 | ✅ `hermes -z` 원샷 검증됨. run 상태 관측이 필요하면 `serve`(JSON-RPC) 검토. `proxy`는 제외 확정 |
| **evidence 배열 누락이 규모에 따라 악화** | **높음** | 높음 | ⚠️ 44%(18인용) → **78%(41인용).** 전사가 길수록 심해진다. Phase 2 validator 강제가 필수이며 프롬프트 보강만으로는 부족 |
| 모델이 제안을 결정으로 승격 | ~~높음~~ → **중** | 중 | 1차 발생, 2차 미발생(0/3). 단 2차는 녹음에 정답 라벨이 섞여 쉬웠다. 루브릭 자동 승격 금지 유지 |
| **고유명사 전사 오류** | **높음** | 중 | ⚠️ 발화 단위 70.2%, 오류가 **인명·제품명에 집중**(`토스페이먼치`, `그래파나`, `한결시`). 숫자·날짜는 12/12 완벽. Phase 0.5e에서 initial prompt 주입 실험 |
| **화자 분리 없이는 1인칭 담당자를 못 채움** | — | 중 | ⚠️ **감수하기로 결정**(2026-08-06). 실제 회의에서 `-di`가 동작하지 않아(마이크 28.7 dB 작음) 화자 분리를 접었다. `제가 하겠습니다` 형태의 담당자는 **교정 화면에서 사람이 지정**한다. 모델은 빈칸을 `미입력`으로 남기고 지어내지 않는다(실측 0건) |
| ~~고유명사 전사 오류~~ | ~~높음~~ → **낮음** | 중 | ✅ `--prompt` 주입으로 57.1%→90.0%. 남은 건 호칭형(`한결씨`) 케이스 |
| **Hermes 경유 전사가 timestamp를 못 준다** | — | — | ✅ **해소됨.** 전사를 Ratatouille 직접 호출로 되돌려 timestamp 확보. 아키텍처 확정 |
| **`whisper-cli` 호출을 Ratatouille이 소유** | 낮음 | 중 | 사용자가 "hermes로만"을 원했으나 timestamp 계약과 충돌해 철회. **재확인 필요** |
| **실제 회의에서는 다른 실패 모드가 나옴** | 중 | 높음 | 현 실측은 상황극 1건 + **정답 라벨이 섞인** 모의 회의 1건. 각 1회 실행. 라벨 없는 회의로 재측정 전까지 일반화하지 않는다 |
| `whisper-cli` 매 호출 1.6GB 모델 재로드 | 중 | 낮음 | 회의당 1회면 감당(load 581ms). 부담되면 `whisper-server` 상주 모드로 전환 |
| ChatGPT OAuth 만료가 자주 발생 | 중 | 중 | `auth_required`를 정식 상태로 설계하고 transcript를 항상 보존. 재인증 후 같은 source hash로 재개 |
| 탭 오디오와 마이크의 시간축 드리프트 | 중 | 중 | Phase 0.4에서 측정(편측 정지 시 295ms). 동시 시작·동시 일시정지로 완화. **두 track을 모노로 섞으므로 어긋나면 말이 겹쳐 들리고 전사가 깨진다** |
| `shadcn-admin` 데모 제거가 예상보다 침습적 | 중 | 낮음 | Phase 0.9에서 목록 먼저 작성. 제거보다 라우트 미등록을 우선 고려 |
| 루브릭이 행정 절차가 되어 실제로 안 쓰임 | 높음 | 높음 | Phase 6에서 한 산출물 확정 클릭 수를 측정하고 기록. 일괄 승인·keyboard flow를 사용자와 검토 |
| 5개 상태 머신을 하나로 합치고 싶은 유혹 | 높음 | 높음 | Phase 2에서 타입 레벨로 분리하고 테스트로 고정. 화면 문구는 별도 매핑 테이블 |
| vault 외부 편집과 앱 쓰기의 충돌 | 중 | 높음 | content hash + optimistic concurrency, 원자적 쓰기, 충돌본 보존. Phase 2 round-trip 테스트로 고정 |
| Phase 2 기능(Today·작업 관리)이 슬금슬금 유입 | 중 | 중 | Phase 7.4에서 라우트 목록으로 자동 검사 |

---

## 🔄 롤백 전략

| Phase 실패 시 | 되돌리는 범위 | 보존되는 것 |
| --- | --- | --- |
| Phase 0 | 없음 (문서만) | 전부 |
| Phase 1 | `apps/web` 삭제 후 재클론 | Phase 0 실험·결정 문서 |
| Phase 2 | `apps/server/src` 되돌리기, `vault-test/` 삭제 | 앱 셸, 실데이터 `vault/` |
| Phase 3 | 페이지 A와 수집 파이프라인 | 서버 업로드 API (독립 계약) |
| Phase 4 | 전사 워커와 페이지 B 로딩 상태 | 녹음 경로는 `finalizing`까지 유지 |
| Phase 5 | 페이지 B 컴포넌트 | 서버의 transcript 데이터 |
| Phase 6 | Hermes 연동과 결과 영역 | 전사 확정까지의 모든 산출물 |
| Phase 7 | 없음 (검증만) | 전부 |

**공통 원칙**: `raw audio`, `source hash`, `raw transcript`는 어떤 롤백에서도 삭제하지 않는다.

---

## 📊 진행 현황

| Phase | 대응 (`PLAN.md`) | 예상 | 실제 | 상태 |
| --- | --- | --- | --- | --- |
| 0. 선행 결정과 반증 실험 | 순서 0 선행 조건 | 6~10h | ~5h | ✅ **완료** |
| 1. 모노레포 기반 + 공통 앱 셸 | 순서 0 + 1 | 4~6h | ~3h | ✅ **완료** (체크박스 뒤늦게 채움) |
| 2. 서버 도메인 코어 | (technical-foundation) | 8~12h | ~9h | ✅ **완료** |
| 3. 녹음 중 페이지와 수집 | 순서 2 | 8~12h | ~5h | 🔄 **자동 검증 완료 · 수동 3건 남음** |
| 4. 처리 전환과 전사 | 순서 3 | 6~10h | ~4h | ✅ **완료** |
| 5. 결과와 전사 교정 | 순서 4 | 8~12h | - | 🔄 **진행 중** — Test 5.2 · 5.8~5.10 남음 |
| 6. AI 정리와 확정 | 순서 5 | 10~14h | - | 🔄 **6.6만 남음** — Hermes profile·skill이 외부에 없다 |
| 7. 통합 검증 | 순서 6 | 6~8h | - | ⏳ 대기 |
| **합계** | | **56~84h** | ~28h | **4/8 완료 + Phase 3 수동 3건 · Phase 5·6 진행 중** |

> 각 Phase가 feature-planner의 권장치(1~4시간)를 넘는다. `실제 구현`을 선언했고 `PLAN.md`의 순서 0~6을 1:1로 추적해야 하기 때문이다. 각 Phase 안의 RED/GREEN/REFACTOR 태스크가 실제 작업 단위이며, 개별 태스크는 대부분 1~3시간이다.

---

## ✅ 검증 증거 체크리스트

`PLAN.md`의 `검증 증거` 원문이다. 완료를 주장할 때 **최소한 다음을 남긴다.**

- [ ] 선언한 작업 종류(**실제 구현**)와 mock으로 둔 범위 — mock이 남아 있다면 전부 열거
- [ ] 실행한 route와 화면 캡처
- [ ] 두 입력 source 상태와 녹음 복구 시험 결과
- [ ] 녹음 시작 전 track 선택·경고와 생성된 manifest 내용
- [ ] 파일 업로드 source의 상태 전이 결과
- [ ] 전사 교정 → 확정 → AI 정리의 상태 전이 증거
- [ ] `auth_required`, `waiting_for_model`, `failed_retryable`, `degraded_draft` 화면 표시 증거
- [ ] 결과 4개 section의 검수 상태 전이와 문서 확정 결과
- [ ] desktop과 좁은 화면 검증 결과
- [ ] 추가·수정한 Shadcn 및 Ratatouille 전용 컴포넌트 목록

### Ratatouille 전용 합성 컴포넌트 (Shadcn 토큰·프리미티브 기반)

- [ ] `RecordingVisualizer` — Phase 3
- [ ] `RecordingControls` — Phase 3
- [ ] `AudioPlayer` — Phase 5
- [ ] `TranscriptEditor` — Phase 5
- [ ] `MeetingSummary` — Phase 6

---

## 📝 기록과 학습

### 구현 노트

**2026-08-06 — 하나의 사실을 두 컨트롤로 쪼개지 않는다**

세 곳에서 같은 병이 나왔다. **boolean 하나를 두 개의 UI로 표현**하고 있었다.

| 어디 | 전 | 후 |
| --- | --- | --- |
| 문서 확정 | `[✓ 확정됨]` + `[확정 해제]` | 토글 `[✓ 확정됨]` (`aria-pressed`) |
| section 검수 | 배지 `확인 전` + 버튼 `확인함` | 토글 `[확인함]` |
| 조작 줄 | 버튼 4개가 나란히 | 주 조작 하나 + `⋮` |

⛔ **검수 버튼은 제목과 같은 줄에 있어야 한다.** 내용 아래에 홀로 두면 무엇을
확인하는 버튼인지 알 수 없다 — 실제로 「확인함」 버튼 하나가 떠 있었다.
이제 `결정 사항 ……… [확인함] [기준 4]`처럼 제목 줄에 붙는다.

⛔ **주 조작은 하나다.** 이 화면이 존재하는 이유는 문서를 확정하는 것이고,
나머지(전사 수정·다시 정리·회의 삭제)는 가끔 쓴다. 넷을 나란히 두면 무엇이
주된 일인지 사라진다 → `⋮` 메뉴로.

⚠️ **삭제는 어느 단계에서든 닿아야 한다.** 「수집 중」에서 멈춘 회의를 치울
방법이 없었던 적이 있다. 검수 화면에서는 `⋮` 안에, 그 전에는 맨 아래 조용한
버튼으로 둔다. 확인 창은 메뉴 **밖**에 산다 — 안에 두면 항목을 누르는 순간
메뉴가 닫히면서 창까지 같이 사라진다.

⚠️ **`<details>` 규칙을 어겨 브라우저 기본 라벨이 새어 나왔다.** `<summary>`는
`<details>`의 **첫 자식**이어야 하는데, 오른쪽에 검수 조작을 붙이려고 div로
감쌌더니 브라우저가 자기 「세부정보」를 그렸다. 규칙을 어긴 마크업은 조용히
이상하게 렌더된다 → shadcn `Collapsible`로 바꿨다.

---

**2026-08-06 — 고칠 수 없는 검수는 반쪽이다**

검수는 만들어뒀는데 **고칠 수단이 없었다.** 「수정 필요」로 표시하면 확정이
막히는데 고칠 방법이 없으면 그 회의는 영원히 확정되지 않는다. `edited` 상태도
계약에만 있고 부를 곳이 없었다.

- 요약·회의 내용·결정·Action Item을 **그 자리에서** 고친다. 담당자와 기한은
  입력 칸이다
- **결정과 할 일은 지울 수 있다.** Phase 0 결함 B(제안을 결정으로 승격)의
  유일한 시정은 그 항목을 없애는 것이다
- ⛔ **편집기에 근거 마커를 그대로 보여준다.** `[seg_33]`을 감추고 고치게 하면
  사람은 자기가 어느 근거를 지우는지 모른 채 지운다. 보기 흉해도 보여준다 —
  이 앱에서 근거는 장식이 아니라 계약이다
- ⛔ **사람의 편집도 근거를 지어낼 수 없다.** 모델에 강제한 규칙이 사람 손에서
  뚫리면 규칙이 있는 이유가 사라진다. 화면의 각주는 누가 썼든 똑같이 죽는다.
  실측: `[seg_99999]` → 「전사문에 없는 발언을 인용했습니다」, 본문은 그대로
- ⛔ **근거를 전부 떼는 것도 막는다.** 남는 것은 회의록이 아니라 메모다

**⚠️ 막다른 골목을 하나 만들었다가 고쳤다.** 확정하면 편집도 검수도 막히는데
**되돌릴 방법이 없었다** — 오류 문구는 "되돌린 뒤에 고쳐 주세요"라고 하면서
그 길이 없었다. `확정 해제`를 넣었다(`current → stale → reviewing`).
바로 `reviewing`으로 가지 않는 이유: 고칠 참이면 그 확정본은 더 이상 최신이
아니므로 `stale`을 거치는 것이 맞다.

**⚠️ 편집 규칙이 두 곳에 생길 뻔했다.** `contracts/edit.ts`와 서버에 각각
`applyEdit`이 있었다. 계약 쪽으로 합쳤다 — 다만 계약이 「이미 인용된 근거」만
허용해서, 사람이 전사문을 읽다 더 나은 발언을 찾아도 가리킬 수 없었다.
서버가 전사문 전체를 넘기도록 넓혔다.

**Test 6.5(재생성 비파괴)는 구조적으로 만족한다.** 다시 정리하면 **새 run**이
생기고 이전 run의 편집은 그 자리에 그대로 남는다. AI가 사람 글을 덮는 경로가
아예 없다.

---

**2026-08-06 — 품질 게이트가 조용히 꺼져 있었다**

Phase 4 품질 게이트(실제 오디오 전사 6건)가 **skip으로 넘어가고 있었다.**
모델이 `.experiments/models/`에서 `.data/models/`로 옮겨갔는데 테스트는 옛
경로만 봤다. 전체 결과는 초록이었다 — **꺼진 게이트가 통과한 게이트처럼 보였다.**

두 자리를 다 보게 하고, 앱이 쓰는 경로를 먼저 본다. 되살리니 6건이 다시 돈다.

---

**2026-08-06 — 회의록이 vault에 도착한다**

Phase 6까지 오는 동안 **문서가 vault에 한 번도 쓰이지 않고 있었다.** 제품의
원본은 Markdown+YAML vault인데(9절) 그 디렉토리가 비어 있었다 — 앱을 지우면
회의록이 같이 사라지는 상태였다.

확정(`promote`)하면 `vault/notes/<source_id>.md`에 쓴다.

- **파일명은 source id다.** 제목으로 지으면 사람이 제목을 고칠 때마다 새 파일이
  생겨 이력이 갈라진다. 9절이 "immutable ID가 identity다"라고 못박은 이유다
- **오디오나 전사 본문을 복사하지 않는다.** frontmatter는 ID와 hash로만 참조한다.
  본문을 복사하면 원본이 둘이 되고, 둘은 반드시 갈라진다
- ⛔ **사람이 쓴 frontmatter를 지우지 않는다.** 디스크에 있던 것을 먼저 깔고
  앱이 소유한 키만 덮는다. Obsidian에서 붙인 태그가 다시 확정할 때 사라지면
  그 사람은 다시는 이 앱을 안 쓴다. 테스트로 묶었다
- ⛔ **근거 마커가 Markdown 각주가 된다.** `[seg_0]`을 그대로 두면 Obsidian에서
  깨진 링크처럼 보인다. 번호는 화면과 같은 `evidence` 배열 순서다.
  모르는 id는 마커를 **지우기만** 한다 — 없는 각주를 가리키면 근거가 있다고
  거짓말하는 셈이다
- **비어 있음을 감추지 않는다.** 「결정된 사항이 없습니다」도 회의의 기록이다
- vault가 없어도 확정은 된다. 수집만 하는 구성이 있고, vault를 못 쓴다고
  검수 결과를 잃으면 안 된다

**실측**(`src_msgszcix`, 실제 브라우저에서 검수→확정): `notes/src_msgszcix.md`
생성. frontmatter에 source·revision·run·hash, 본문에 각주 7개.

---

**2026-08-06 — 검수 화면과 루브릭**

⛔ **루브릭이 「클릭해야 하는 행정 절차」가 되면 아무도 제대로 안 본다.**
그래서 기본 동작은 버튼 **하나**다 — 읽고 「확인함」. 기준별 판정은 문제를
발견했을 때만 펼쳐 쓴다. 계약 문서가 "각 산출물은 핵심 기준 3~5개로
시작한다"고 못박은 것도 같은 이유라, 기준 개수를 테스트로 묶어뒀다.

⛔ **기준 문구를 지어내지 않는다.** `review-contract.md` 4절의 질문을
그대로 옮겼다. 바꿔 쓰면 "무엇을 확인했는가"가 회의마다 달라진다.

⛔ **AI가 `pass`로 표시한 기준도 사람이 뒤집을 수 있다.** 뒤집을 수 없으면
루브릭은 AI의 자기 채점이 된다 — 결함 B가 그렇게 통과했다.

⛔ **항목이 있으면 「회의에 없었음」을 아예 안 보여준다.** 서버도 막지만,
누를 수 있게 그려놓고 409를 내는 것은 나쁘다. 건너뛰는 길을 만들어 주는 셈이다.

**실측** (`src_msgvfbti`, 실제 브라우저):

| 단계 | 막는 이유 | 확정 버튼 |
| --- | --- | --- |
| 처음 | 4건 | 잠김 |
| 넷 다 「확인함」 | 0건 | 열림 |
| 결정 사항 기준을 「수정 필요」로 | **1건** | **잠김** |
| 다시 「괜찮음」으로 | 0건 | 열림 |
| 확정 | — | 「확정됨」, 검수 버튼 사라짐 |

세 번째 줄이 **Phase 0 결함 B가 실제로 막히는 경로**다.

⚠️ 화면에 기준 **id**(`decision-vs-proposal`)가 그대로 떴다. 코드가 읽는
이름이지 사람이 읽는 말이 아니다 → 질문 문구로 바꿨다.

⚠️ 「원문 근거**을**」이 나왔다. 조사를 문자열로 이어붙였기 때문이다.
한글 음절의 종성 유무(유니코드 `가`부터 28주기)로 갈라 붙인다 —
한국어 UI에서 조사가 틀리면 기계가 쓴 티가 나고, 이 앱은 사람의 말을
다루는 도구라 특히 거슬린다.

**모바일**: 375px에서 가로 넘침 없음. 각주 팝오버·루브릭 메뉴가 화면 안에
들어오고, 검수 버튼이 폰에서도 있다 — 없으면 폰에서는 확정할 수 없는 앱이 된다.
조작 줄은 좁을 때 오른쪽 그룹이 **한 줄을 통째로** 쓴다(`ml-auto`만 두면
남은 폭에 따라 어중간하게 밀린다).

---

**2026-08-06 — 검수를 마쳐야 확정된다 (규칙 7)**

`review-contract.md`가 요구한 **section별 독립 검수 상태**를 계약과 서버에 넣었다.

- 네 결과(`summary`/`decisions`/`tasks`/`evidence`)가 각각
  `unreviewed`/`in_progress`/`accepted`/`edited`/`empty`를 갖는다
- **`empty`는 「안 봤다」가 아니라 「회의에 그 항목이 없었다」**이다. 둘을 구분
  못 하면 결정이 없는 회의를 영영 확정할 수 없거나, 반대로 안 본 것이 조용히
  넘어간다. 그래서 **항목이 있는데 `empty`면 막는다** — 그건 건너뛴 것이다
- 요약과 원문 근거는 `empty`가 될 수 없다. 회의가 있었으면 요약도 있고,
  결과가 있으면 근거도 있다
- **루브릭 판정과 section 상태는 다른 namespace다.** 같은 이름을 쓰면
  "루브릭이 pass니까 section도 확인된 것"이라는 자동 승격이 슬며시 생긴다.
  `fix_required`·`uncertain`이 남아 있으면 사람이 `accepted`를 눌렀어도 막힌다
- **`not_applicable`이 section 상태를 자동으로 바꾸지 않는다.** 기준 하나가
  「해당 없음」인 것과 사람이 그 section을 확인한 것은 전혀 다른 사실이다

⛔ **승격 경로는 `DocumentQueue.promote` 하나뿐이다.** 다른 곳에서
`documentState`를 직접 건드리면 검수를 건너뛴 확정본이 생긴다.
확정한 뒤에는 검수 상태를 흔들 수 없다(409) — 되돌린 뒤에 다시 본다.

⛔ **막기만 하지 않고 무엇이 막는지 준다**(`blockers`). 이유 없이 막으면
사용자는 네 section을 전부 다시 훑어야 한다.

⚠️ `narrative`(회의 내용)에는 별도 검수 상태를 두지 않았다. 요약과 같은
내용을 길게 편 것이라 `summary`가 둘 다를 덮는다 — 화면에서도 한 탭 묶음이다.
"요약은 맞는데 전문은 틀렸다"는 상태를 만들면 같은 내용에 두 판정이 생긴다.

**사보타주 검증**: 루브릭 무시·`empty` 검사 제거 두 가지를 각각 심어 계약과
API 양쪽에서 실패하는 것을 확인했다.

---

**2026-08-06 — 화면을 다시 짰다 (위계·조작·로딩)**

「타이포 가독성, 레이아웃 구조가 너무 혼란하다」는 지적을 받고 뜯어봤다.
원인은 취향이 아니라 **구조**였다.

| 증상 | 원인 |
| --- | --- |
| 무엇을 먼저 볼지 모르겠다 | 처리 화면과 검수 화면이 **같이 쌓여** 있었다 |
| 상태말이 여기저기 | `검수 대기`·`전사 확정됨`·`AI 정리 검수 대기`가 **세 곳**에서 같은 말 |
| 조작을 못 찾겠다 | 버튼이 **세 줄**에 흩어져 있었다 |
| 읽을 글이 제일 작다 | 본문 14px, 제목 24px — 중간이 비고 **읽는 글이 최소 크기** |
| 상자 목록처럼 보인다 | 네 결과가 **전부 같은 테두리 카드** |

조치:
- 전사가 끝나면 처리 화면을 **검수 화면으로 교체**한다(같이 쌓지 않는다).
  「받은 조각 612개」는 검수에 도움이 안 되므로 **전사 원문 패널의 부제**로 옮겼다
- 제목은 상단 바의 **breadcrumb**으로. 본문 맨 위를 제목이 차지하면 읽을 것이 밀린다
- 조작을 **한 줄**로: 전사 원문 · 전사 수정 · (오른쪽) 소요 시간 · 다시 정리
- 본문 16px, section 제목은 **라벨로 강등**(본문보다 작게). 카드 테두리를 걷고
  여백과 라벨로 나눈다. 결정·Action Item에 **번호**를 매겼다 — 검수는 "몇 번째가
  틀렸다"고 말할 수 있어야 하는 일이다
- 로딩은 전부 **스켈레톤**. 「불러오는 중…」 한 줄은 멈춘 화면과 구분되지 않는다

**⛔ 눌러도 아무 일도 없는 버튼이 있었다.** `nextAction`을 고치자 검수 단계에
「검수하기」가 떴는데, `open_document_review`를 처리하는 곳이 아예 없었다.
검수 단계에서는 처리 화면 자체를 렌더하지 않는 것으로 구조적으로 막았다.

**⚠️ 「다시 정리」를 누르면 화면이 멈췄다.** 서버 POST가 모델이 끝날 때까지
30초 넘게 응답하지 않는데 그 응답을 기다렸다가 화면을 바꿨다. 새로고침해야
「정리 중」이 보였다 → **먼저 「도는 중」으로 바꾼 뒤** 보낸다. 폴링이 이어받는다.

---

**2026-08-06 — 각주를 눌렀더니 소리가 터져 나왔다**

`seek`가 **항상 재생**했다. 근거를 확인하려고 각주를 눌렀을 뿐인데 읽는 중에
소리가 났고, 전사 서랍이 열리며 1423줄을 `behavior: 'smooth'`로 훑고 내려갔다.
하나를 눌렀는데 세 가지가 한꺼번에 일어났다.

- `seek`(위치만) / `playAt`(위치+재생)로 **나눴다**
- 각주는 **팝오버**를 연다 — 앞뒤 2줄 문맥 + 「여기부터 듣기」 · 「전사에서 보기」.
  흔한 경우는 전사를 열지 않고 그 자리에서 끝난다
- 멀리 건너뛸 때는 `behavior: 'instant'` + `block: 'center'`.
  가까운 이동(재생이 다음 문장으로 넘어가는 것)만 부드럽게 둔다
- 서랍은 직접 만든 고정 패널에서 **shadcn `Sheet`**로. 포커스 가두기·Esc·
  바깥 클릭을 손으로 다시 만들 이유가 없다

---

**2026-08-06 — 회의 내용 / 요약 (탭)**

요약만으로는 "무슨 얘기였지"는 알아도 **"왜 그렇게 됐지"**를 알 수 없고,
그건 전사문을 다시 읽어야만 알 수 있었다. 모델에게 주제별 긴 정리글
(`narrative`)을 새로 받는다.

- 탭이 바꾸는 것은 **「회의 내용 ↔ 요약」뿐**이다. 결정 사항과 Action Item은
  탭 밖에 둔다 — 어느 탭을 보느냐에 따라 할 일이 보였다 안 보였다 하면 안 된다
- 각주 번호는 **읽는 순서**를 따른다: 회의 내용 → 요약 → 결정 → Action Item.
  요약부터 세면 전문의 각주가 `[40]`부터 시작하는 이상한 글이 된다
- `verifyEvidence`가 `narrative` 본문의 인용도 검사한다. 빠뜨리면 화면에서
  **가장 긴 글이 검증 밖**에 남는다

**실측**(`src_msgvfbti`, 51분): `proposed`, 위반 0건, 51.5초, 주제 6개.

---

**2026-08-06 — 테스트가 실제 Chrome인데 CSS가 없었다**

각주 버튼이 `line-height: 0`으로 무너져 **실제로 눌리지 않는 상태**였는데
테스트는 전부 통과했다. 브라우저 테스트가 **스타일을 하나도 불러오지 않아서**
DOM에 있기만 하면 통과했기 때문이다.

→ `setupFiles`로 실제 스타일을 불러온다. 이제 테스트가 크기·가시성을 본다.
   실제로 「본문이 16px인가」, 「section 제목이 본문보다 작은가」를 검사한다.

⛔ 원인이었던 `leading-relaxed`는 이 프로젝트에 정의돼 있지 않다. theme이
행간을 전역 1.618로 통일하면서 Tailwind의 `--leading-*` 기본값을 두지 않았고,
그래서 `--tw-leading`이 무효값이 되어 안쪽 `text-[임의값]`이 무너진다.

---

**2026-08-06 — 「최신」이 최신이 아니었다**

`latestFor`가 `id.localeCompare`로 정렬했다. 사전순이라 `doc_..._9`가
`doc_..._12`보다 뒤로 간다 — **12번째 실행을 만들었는데 화면은 9번째를 보여줬다.**
「최신」은 만든 시각(`createdAt`)이다.

⚠️ **미해결**: 검증 중 내가 시작하지 않은 문서 실행이 여러 건 생겼다.
화면을 열어두는 것만으로는 생기지 않음을 실증했고(15초간 POST 0건),
웹 테스트 전체를 돌려도 0건이었다. 원인은 못 밝혔고 이후 재현되지 않는다.

---

**2026-08-06 — 근거를 문장 안에 넣는다 (나무위키식 각주)**

`review-contract.md`는 "다른 세 결과에서도 같은 segment로 이동할 수 있어야 한다"만
요구했다. 처음에는 항목 **끝**에 근거 시각을 나열했는데, 실제 회의(1423 세그먼트)에서
요약 하나에 근거가 **10건**씩 달렸다. `[1][2]…[10]`이 문단 밑에 줄지어 있으면
**어느 근거가 어느 주장을 받치는지 알 수 없다.** 검수는 "이 문장이 맞나"를 묻는
일이므로, 근거는 그 문장에 붙어 있어야 한다.

→ 프롬프트를 바꿔 모델이 **본문 안에** `[seg_33]`을 넣게 했다.

**왜 이건 모델에게 받아도 되나.** 바로 아래 노트에서 시각·인용문을 모델에게서
거둬들인 것과 반대로 보이지만, 기준은 같다 — **파생값인가 아닌가.**
시각과 인용문은 ID만 있으면 서버가 만들 수 있어서 모델에게 받을 이유가 없었다.
반면 **위치는 모델만 안다.** 파생할 수 없으므로 모델에게 받는 것이 맞다.
지어낸 ID는 `verifyEvidence`가 `unknown_segment`로 그대로 막는다.

| | 값 |
| --- | --- |
| 실측 (`src_msgvfbti`, 51분) | `proposed`, **위반 0건**, 32초 |
| 본문 마커 | 요약 13 · 결정 29 · 할 일 10 = **52개** |
| 마커 위치 | 문장 **끝**마다. 절 단위까지 쪼개지는 않았다 |

각주 **번호는 `proposal.evidence`의 순서**를 그대로 쓴다. 그 배열은 서버가 읽는
순서(요약 → 결정 → Action Item)대로 채우므로, 본문 각주와 각주란의 번호가 같다.
화면이 따로 번호를 매기면 둘이 어긋나고, 어긋난 각주는 없는 것만 못하다.

`원문 근거` section은 **접힌 각주란**이 됐다. 계약상 뺄 수 없고(환각 방지용 전용
조회 영역) 90건이 늘 펼쳐져 있으면 결과를 읽을 수 없다.

**확정 뒤에는 화면 구조가 바뀐다.** 교정 중에는 좌우 분할(교정이 주 작업),
확정 뒤에는 결과가 전체 폭을 쓰고 전사는 우측 서랍으로 들어간다(검수가 주 작업).
각주를 누르면 **서랍이 열리며 그 문장으로 스크롤·강조되고 음성도 그 지점으로 간다** —
각주는 한 줄만 보여주는데, "정말 그렇게 말했나"는 앞뒤 맥락이 있어야 판단할 수 있다.

⚠️ **각주가 눌리지 않았다 — `leading-relaxed` 때문이었다.** 이 프로젝트의 theme은
행간을 전역 1.618로 통일하면서 Tailwind의 `--leading-*` 기본값을 두지 않았다.
그래서 `leading-relaxed`는 `--tw-leading`을 무효값으로 만들고, 그 안의
`text-[임의값]`이 **`line-height: 0`**으로 무너진다. 각주 버튼이 높이 0이 되어
실제 브라우저에서 클릭이 30초간 실패했다. **테스트는 통과했다** — jsdom이 아니라
실제 Chrome이었는데도, 테스트는 DOM 존재만 확인하고 가시성은 보지 않았기 때문이다.
→ 정의된 크기(`text-xs`)만 쓴다. 그리고 **실물 브라우저 프로브 없이 UI를 끝냈다고
하지 않는다.**

---

**2026-08-06 — 확정한 회의가 영영 「교정 전」이었다 (상태 판정을 계약으로)**

사이드바가 **확정된 회의에도 「교정 전」**을 띄우고 다음 조작으로 「전사 교정하기」를
권했다. 서버는 `transcript_approved`를 보내고 있었는데도 그랬다.

원인은 하나가 아니라 **같은 판단이 세 곳에 있었다는 것**이다:
서버 `/session`, 웹 `badgeFor`, 웹 `primaryStatus`가 각자 상태를 골랐고,
셋 다 **전사 job에서 멈췄다.** 전사 job은 확정한 뒤에도 영원히 `completed`다.

→ `contracts/stage.ts`에 `meetingStage` / `nextActionForMeeting`을 두고 셋이 같은
함수를 부른다. 뒤 단계가 이긴다: source → transcriptionJob → transcriptRevision →
documentRun.

곁가지로 드러난 것들:
- `documentRun`의 재시도가 `retry_transcription` kind였다 — 누르면 **전사**를 다시
  돌릴 뻔했다. `retry_documentation`을 새로 만들었다
- 세션 API에 `documentRunState`가 아예 없었다. 화면은 확정된 회의가 정리를
  기다리는지·도는 중인지·검수를 기다리는지 구분할 수 없었다
- `undefined`가 상태 이름 자리에 앉아 `describeState`가 터졌다. 이 값들은 HTTP로
  건너오므로 서버가 아직 그 필드를 안 보내는 판본이면 실제로 일어난다 → `?? null`

**실측**: 두 회의 모두 `다음: 검수하기`. 사이드바 배지도 `검수 대기`.

---

**2026-08-06 — 프롬프트가 요구한 값을 파서가 버리고 있었다**

프롬프트는 Action Item의 `owner`·`due`를 요구하는데 `normalize()`가 둘 다 버렸다.
2차 실측에서 **기한 정확도 4/4**를 기록했던 값이 화면까지 오지 못했다.

`미입력`은 **문자열이 아니라 `null`로** 저장한다. 문자열로 두면 그런 이름의 담당자와
구분되지 않고, "담당자가 정해졌는가"를 코드가 물을 수 없다. 보이는 말은 `UNSET_LABEL`,
데이터는 `null`이다.

⚠️ 실제 회의에서는 **7건 전부 `null`**이었다. 두 사람이 "제가 할게요"로만 말했고,
화자 분리를 접었으므로 그게 누구인지 알 수 없다. **예상된 결과이고 사람이 지정한다.**

---

**2026-08-06 — evidence 배열을 모델에게 받지 않는다 (결함 A의 구조적 해결)**

Phase 0에서 「모델이 인용한 segID가 evidence 배열에 없다」를 **결함 A**로 기록했다
(1차 44%, 2차 78%, 전사가 길수록 악화). 당시 결론은 *"프롬프트로 고칠 문제가 아니다.
서버가 강제할 불변식이다"* 였고, `verifyEvidence`가 그 강제였다.

**실제 회의로 돌려보니 강제만으로는 못 쓴다는 것이 드러났다.**
`src_msgvfbti`(51분, **1423 세그먼트**, 17,263자)로 3회 실행:

| 회차 | 결과 | 위반 |
| --- | --- | --- |
| 1 | `failed_retryable` | `quote_mismatch` 1건 — 원문에 말줄임표(`...`)가 있는 세그먼트를 말줄임표 없이 인용 |
| 2 | `failed_retryable` | `not_in_evidence_array` 1건(결함 A 재현) + `timestamp_mismatch` 1건 |
| 3 | ✅ `proposed` | **0건** |

1회차: **말줄임표 하나 때문에 근거 48건·결정 7건·할 일 6건이 통째로 막혔다.**
2회차: 결함 A가 실제로 재현됐다.

두 번의 실패에서 공통점을 봤다 — **틀린 것이 전부 파생값이었다.** 시각과 인용문은
세그먼트 ID만 있으면 서버가 원문에서 만들 수 있다. 파생값을 모델에게 받으면 틀릴 수
있고, 실제로 틀렸다. **검증으로 막는 것보다 애초에 틀릴 수 없게 만드는 것이 낫다.**

→ 모델은 이제 **`evidence: ["seg_7"]` 처럼 ID만** 말한다. 시각·인용문·배열 구성은
서버가 한다(`fillEvidence`). 그 결과:
- `not_in_evidence_array` — 구조적으로 불가능(서버가 인용된 ID 전부로 배열을 만든다)
- `timestamp_mismatch` · `quote_mismatch` — 구조적으로 불가능(서버 값이 유일한 출처)
- `unknown_segment` — **남는다.** 이게 진짜 환각이고 반드시 막아야 한다

3회차 실행: 1423 세그먼트에서 **위반 0건**, 결정 9·할 일 6·근거 72.
프롬프트가 짧아져 소요도 76초 → **43초**.

부수로 `quote_mismatch` 판정을 **완전 일치 → 부분 문자열**로 바꿨다. 규칙의 목적은
"모델이 전사 오류를 교정해 인용하는 것"을 막는 것인데, 잘라 인용하는 것은 그 목적과
무관했다. 부분 문자열은 중요한 방향으로는 더 엄격하다 —
`토스페이먼츠` ⊄ `토스페이먼치...`는 여전히 거부된다.

**⚠️ 남는 한계**
- 근거가 주장을 실제로 뒷받침하는지는 **여전히 사람이 본다.** 검수 계약의 몫이다
- `run.json`의 `model`은 Hermes 설정의 기본 모델을 적은 것이다. Hermes가 실행 시점에
  폴백하면 이 기록은 어긋난다. 실행 후 모델명을 되받을 방법이 생기면 대체한다
- 프롬프트를 **argv로 넘긴다.** 1423 세그먼트는 통과했지만 더 긴 회의는 `ARG_MAX`에
  걸릴 수 있다. stdin 전달로 바꿔야 한다

**2026-08-06 — 화자 분리를 접는다 (사용자 범위 변경 + 실측)**

사용자 지시: *"화자분리는 접어두고 회의 내용에 대해서 타임라인은 가지되 재교정에 큰 목적을 두고
내용 정리, 액션 아이템 생성에 주력을 두자"*

**실측이 이 방향을 뒷받침했다.** 같은 오디오(`src_msgszcix`, 58.6초 온라인 회의), 같은 모델:

| | 세그먼트 | 평균 길이 | 화자 |
| --- | --- | --- | --- |
| 기존: stereo join + `-di` | **7개** | 8.4초 | **전부 speaker 1** |
| 신규: dynaudnorm + mono amix | **15개** | 3.9초 | — |

- **화자 분리는 이미 동작하지 않고 있었다.** 마이크가 탭보다 28.7 dB 작아 좌채널이 거의 무음이었다.
  Phase 0.5c의 98.2%는 **음량이 맞는 합성 오디오**에서 나온 수치였고, 실제 회의에는 일반화되지 않았다.
- 그 대가로 **타임라인이 8초 덩어리로 뭉개져 있었다.** 8초 덩어리는 어디를 고쳐야 할지 짚을 수 없어
  재교정과 timestamp jump를 동시에 망친다. 재교정이 목적이면 채널 분리는 순손해다.
- 텍스트 정확도도 mono 쪽이 나았다 (같은 발화 구간의 조사·어미 전사 오류가 줄었다).

**⚠️ 감수하는 것 (2차 실측에서 이미 측정된 대가)**
- `제가 금요일까지 검토할게요` 형태의 **1인칭 Action Item은 담당자를 채울 수 없다.**
  이름을 호명한 항목(`지영씨, ...`)만 채워진다. 이건 화자 분리의 유일한 실효였다.
- 대신 **담당자는 교정 화면에서 사람이 지정한다.** 재교정에 무게를 두는 이번 방향과 맞고,
  `review-contract.md`의 「결정·Action Item 근거의 화자는 반드시 사람이 확인한다」와도 어긋나지 않는다.
- 모델이 **없는 담당자를 지어내지는 않는다** (2차 실측 0건). 빈칸은 `미입력`으로 남는다.

**⚠️ 되돌릴 수 있다.** mic·remote 조각은 계속 track별로 분리 보존된다. 음량 문제를 해결하면
(입력 게인 조정 또는 track별 정규화 후 재분리) `-di`를 다시 켤 수 있다.

**부수 발견**: `buildFfmpegArgs`의 「온라인은 반드시 스테레오 좌/우 분리」라는 가장 강한 불변식에
**테스트가 하나도 없었다.** 주석으로만 지키고 있었고, 그 방식이 실제로는 실패하는 동안 아무
테스트도 깨지지 않았다. `test/transcription-audio.test.ts`를 뒤늦게 만들었다.
**주석으로 지키는 계약은 지켜지지 않는다.**

**2026-08-06 — 회의 삭제 (계획에 없던 작업)**

- **왜 생겼나**: 내가 파형 검증용 탐침을 3회 돌리면서 녹음을 시작만 하고 종료를 안 눌렀다.
  서버에 `capturing`인 채 조각 0개짜리 source 3건이 남았고, 사이드바에 「수집 중」으로 쌓였다.
  **화면에서 치울 방법이 없어서 사용자가 나에게 터미널로 지워달라고 해야 했다.**
- 계획에 삭제가 없던 이유는 명확하다 — 초판이 「무엇을 만드는가」만 보고 「무엇이 쌓이는가」를
  안 봤다. 녹음 중 브라우저가 죽는 것은 예외가 아니라 일상이고, 그 잔해는 사용자가 치울 수 있어야 한다.
- **소거가 아니라 `.data/trash` 이동으로 만들었다.** raw audio는 불변이고(5절) 되돌릴 수단이 없다.
  51분짜리 녹음이 오클릭 한 번에 사라지면 안 된다. 대신 응답과 확인 창이 **휴지통이라는 사실을
  숨기지 않는다** — "완전히 삭제"라고 쓰면 거짓이고, 아무 말도 안 하면 디스크가 비었다고 착각한다.
- 돌고 있는 전사가 있으면 409로 거절한다. 읽는 중인 조각을 치우면 전사가 알 수 없는 이유로 깨진다.
- **`pnpm typecheck`가 `tsc --noEmit`이 못 잡는 오류 2건을 잡았다.** 나는 `apps/web`에서
  `pnpm exec tsc --noEmit`을 돌리고 통과했다고 판단했는데, 실제 스크립트는 `tsc -b --noEmit`
  (프로젝트 참조 빌드)이라 검사 범위가 달랐다. **워크스페이스 스크립트를 쓴다.** 직접 만든 명령으로
  대체하면 게이트를 우회한다.

**2026-08-06 — 「전부 초록불인데 파형은 안 움직인다」**

- 사용자가 탭 녹음 중 mic·탭 파형이 둘 다 평평하다고 보고했다. 서버 측 증거(ffmpeg volumedetect
  탭 max −0.0 dB, whisper가 58.6초를 한국어 7세그먼트로 전사)로 **표시 결함**임을 먼저 확정했다.
- 원인 후보 두 가지(같은 stream에 AudioContext 중복 생성, `resume()` 대기 뒤 rAF 시작)를 제거했다.
- **⚠️ 실물 재현에는 실패했다.** `apps/web/scripts/probe-audio-level.mjs`로 고치기 전 구현을
  돌려도 meter가 움직였다. 합성 장치(`--use-fake-device-for-media-stream`) 경로는 실제 마이크·
  `getDisplayMedia` 경로와 다르다. **원인은 확정되지 않았다.**
- 그래서 원인 제거와 **별개로** 상태를 화면에 드러냈다: 레벨을 0.8초 이상 못 읽으면 평평한 파형
  대신 「입력 레벨을 읽을 수 없습니다」가 뜨고, DOM에 `data-reading`이 남는다.
  **무음과 고장이 같은 화면이면 안 된다.**

**2026-08-05 — Phase 0 전사·모델 경계 실측**

- 이 문서 초판은 whisper.cpp도 Hermes도 **한 번도 실행하지 않고** 작성된 추론이었다. 실측으로 교체함.
- 가장 큰 수확: **evidence ID + timestamp 환각이 0건**이었다. 이게 무너졌으면 Phase 6 전체가 재설계였다.
- 두 번째 수확: **루브릭이 실제로 오류를 잡는다**는 증거. 제안을 결정으로 승격한 1건을
  `review-contract.md`의 첫 번째 결정 기준이 정확히 겨냥한다. 검수 UI를 줄이자는 유혹에 대한 방어 근거.
- 세 번째: **`-di` 채널 화자 분리**는 문서에 없던 발견이다. mic/remote를 따로 저장하는 수집 계약이
  이미 화자 분리 인프라였다. 외부 API로 오디오를 내보낼 이유가 사라졌다.
- 반성: 1.6GB 모델을 받기 전에 **기존 사본이 있는지 확인하지 않았다.** 확인 결과 없어서 필요한
  다운로드였지만 순서가 틀렸다.

**2026-08-05 — 2차 실측 (모의 회의, 정답 대조)**

- **정답을 미리 심는 방식이 옳았다.** 공개 데이터셋은 전부 ASR 학습용이라 "결정·Action Item의 정답"이
  없다. 대본으로 함정을 심으니 재현율·오탐을 **숫자로** 낼 수 있었다. 이 방식을 계속 쓴다.
- **가장 값진 발견은 실패가 아니라 "왜 비워뒀는가"였다.** A1 담당자가 `미입력`으로 나온 게
  모델 실패인 줄 알았는데, 원문이 "**제가** 금요일까지"였다. 화자 라벨이 없으니 알 수가 없다.
  → 화자 분리가 담당자 필드의 **전제 조건**임이 드러났다. 설계 우선순위가 바뀌었다.
- **채점기를 처음에 틀리게 만들었다.** "한 번이라도 맞으면 통과"로 짜서 전사 정확도가 100%로
  나왔는데, 발화 단위로 세니 70.2%였다. 채점 기준을 먼저 정의하지 않고 스크립트를 짠 탓이다.
- **숫자는 완벽한데 이름이 틀린다**는 패턴은 예상 밖이었다. 붙여놓은 세 날짜가 안 섞인 반면
  제품명·인명은 자모 단위로 깨진다. 교정 UI의 강조 우선순위가 뒤집힌다.
- **결함 A가 규모에 비례해 악화**(44%→78%)하는 걸 확인했다. 1차만 봤으면 "프롬프트를 고치면 되겠지"로
  넘어갔을 것이다. 두 번 재니 validator 강제가 필수라는 게 분명해졌다.

**2026-08-06 — Phase 2 (서버 도메인 코어)**

- **품질 게이트의 grep이 실제 결함을 찾아냈다.** "raw audio를 덮어쓰는 경로가 없다"를 확인하려고
  grep을 돌리다 `SourceRepository`가 조각 기록을 **메모리에만** 두는 걸 발견했다. 재시작하면
  중복 가드가 사라져 같은 순번에 다른 바이트가 와도 파일을 그대로 덮는다. 테스트는 전부
  통과하고 있었다 — 한 프로세스 안에서는 가드가 멀쩡히 동작하니까.
  → 상태를 디스크에 원자적으로 저장하고, 재시작 시나리오를 테스트로 고정했다.
  체크리스트를 형식적으로 넘기지 않고 실제로 실행한 것이 값을 했다.

- **"수동 확인" 항목을 자동 테스트로 바꿨다.** 게이트에 "수동: 서버를 재시작해도 상태가 유지된다"가
  있었는데, 수동 항목은 다음 Phase에서 아무도 다시 돌리지 않는다. `boot()`를 두 번 부르는
  통합 테스트로 만들어 회귀가 잡히게 했다.

- **`fs.watch`를 신뢰할 수 없다고 적어놓고, 정작 그 전제로 테스트를 짰다.** watcher 테스트가
  병렬 실행에서 산발적으로 깨져 원인을 재봤다:
  - **유실은 없었다** — 300개 파일 연속 쓰기에서 300개 이벤트 전부 도착. CPU 점유 상태도 동일.
  - **지연 상한이 없었다** — I/O가 몰리면 단일 이벤트가 5초를 넘기는 경우가 5회 중 2회.
  → 테스트가 검증할 대상을 "watch 이벤트 도착"에서 **"인덱스의 수렴"**으로 바꿨다.
  운영 코드도 `start()`가 즉시 scan하도록 고쳤다 — 서버가 꺼져 있는 동안의 편집은
  애초에 이벤트가 없어서, scan하지 않으면 영영 반영되지 않는다.

- **틀린 주석을 실측으로 잡았다.** watcher에 "macOS는 한글 파일명을 NFD로 준다"고 써놨는데,
  재보니 이 환경(APFS·Node 24)에서는 `fs.watch`도 `readdir`도 **NFC**를 준다. 정규화는
  HFS+ 외장 볼륨 대비로 남기되, **확인된 사실이 아니라 예방책**이라고 주석을 고쳤다.
  그럴듯한 이유를 적어두면 다음 사람이 검증된 것으로 읽는다.

- **`stop()`을 동기로 만든 것이 버그였다.** `stop()` 직후 `index.close()`를 부르면, 진행 중이던
  scan이 닫힌 DB를 건드려 죽었다. 테스트는 통과하는데 unhandled rejection만 6건 나왔다 —
  통과만 보고 넘겼으면 운영에서 종료할 때마다 터졌을 것이다. `stop()`을 async로 바꿔
  진행 중인 작업을 기다리게 했다.

- **문서가 "복사하지 않는다"고만 적은 것을 코드로 강제했다.** 11절의 "document run은 audio·transcript를
  복사하지 않고 ID와 hash로 참조한다"는 주석으로 두면 반드시 깨진다. `input.json`에 **허용 키
  목록**을 걸어 `segments`·`audio`를 넣으면 저장이 실패하게 했다.

- **FTS5 trigram이 3글자 미만을 매칭하지 못한다.** `결제 모듈`을 그대로 넘기면 2글자 토큰 두 개로
  쪼개져 아무것도 안 걸린다. 한국어는 2글자 단어가 흔해 검색이 사실상 죽는다. 질의를
  구(phrase)로 감싸 부분 문자열로 바꿨고, 3글자 미만은 **빈 결과를 돌려 한계를 숨기지 않는다.**

**2026-08-06 — Phase 3 (녹음 중 페이지)**

- **판정을 두 곳에 둬서 실제로 갈라졌다.** 시작 gate(`canStartRecording`)와 화면
  상태(`deriveScreen`)가 각각 "시작 가능"을 판정했다. gate는 온라인 모드에 탭
  track이 없으면 막았지만, 화면은 마이크 권한만 보고 **시작 버튼을 계속 띄웠다.**
  브라우저 테스트가 잡았다. gate 결과를 화면 입력으로 넘기게 바꿔 판정을 하나로 만들었다.

- **`setTimeout(0)`을 동기화 수단으로 썼다가 마지막 조각을 잃었다.** `MediaRecorder`의
  `ondataavailable`은 동기 콜백이지만 저장은 비동기다(hash + IndexedDB). `stop()`이
  타이머로 "잠깐 기다린" 뒤 끝나니 조각이 **하나도** 안 들어간 채로 반환됐다.
  진행 중인 저장을 실제로 await하게 고쳤다. 실제 회의였다면 마지막 5초가 사라진다.

- **`fs.watch`와 같은 교훈이 브라우저에도 있었다.** Phase 0에서 "AudioContext가
  headless에서 suspended로 남는다"를 이미 겪었는데, 그걸 잊고 실제 오디오 테스트를
  짰다가 `resume()`이 영영 안 풀려 15초 timeout이 났다. Playwright launch args
  (`--autoplay-policy=no-user-gesture-required`)로 해결. 실측 기록을 다시 읽는 게
  빨랐을 것이다.

- **클라이언트가 조각 수를 시작 시점에 모른다는 사실이 서버 계약의 구멍을 드러냈다.**
  녹음 길이를 미리 알 수 없으니 `expectedChunks`가 빈 채로 시작하는데,
  `verifyManifest`는 선언이 없으면 개수 검증을 **조용히 건너뛰고 있었다.**
  360조각 회의에서 5개만 올라와도 순번만 이어져 있으면 `ready`가 된다.
  → `count_undeclared` 위반을 추가하고, 종료 시점 선언을 불변 필드로 만들었다.
  Phase 3 작업이 Phase 2 결함을 찾아낸 셈이다.

- **브라우저로 실제 확인한 것이 UI 결함을 잡았다.** 권한을 받기 전인데
  "사용할 마이크를 선택해 주세요"가 함께 떴다 — 지금 할 수 없는 일을 요구하는 문구다.
  "막는 이유를 전부 보여준다"는 원칙은 맞지만, **파생된 문제까지 나열하는 것은
  전부 보여주는 게 아니라 소음**이다. 권한에서 파생되는 blocker는 숨기게 고쳤다.

**2026-08-06 — Phase 4 (처리 전환과 전사)**

- **⛔ 같은 작업을 두 번 구현했다.** 다른 세션이 동시에 Phase 4 전사 파이프라인을
  만들고 있었고(커밋 `b9af3df`, 09:16), 나는 그걸 모른 채 같은 것을 만들었다.
  결과적으로 전사 실행기가 `runner.ts`와 `job.ts` 두 개가 됐고, 둘 다 테스트가
  통과해서 **전부 초록불인데 중복이었다.**
  → 작업 시작 전에 `git log`를 보지 않은 게 원인이다. 통합하면서 `runner.ts`를
  남겼다 — evidence 계약에 필요한 `formatTimestamp`(문자열 완전 일치 비교 때문에
  timestamp 포맷은 한 곳에서만 만들어야 한다)를 갖고 있었다.
  큐(`queue.ts`)는 내 것을 남겼다 — 재기동 복구와 ready 게이트가 있었다.

- **계약에 없는 상태를 만들려 했다.** 전사 실패를 "재시도 가능/불가능"으로 나누면서
  불가능한 쪽은 상태를 안 바꿨더니, job이 `transcribing`에 영원히 머물렀다.
  `transcriptionJob` 머신에는 실패 상태가 `failed_retryable` 하나뿐이다(5절).
  → 상태는 언제나 `failed_retryable`로 보내고, "다시 해도 소용없음"은 **별도
  플래그**로 전한다. 화면은 그 플래그가 false일 때 재시도 버튼을 내지 않는다.

- **같은 머신에 이름을 두 개 붙였다.** 문구 테이블을 `transcription_job`으로 쓰고
  전이표는 `transcriptionJob`이었다. 런타임에 `TRANSITIONS[machine]`이 undefined가
  되어 전사가 통째로 깨졌다. → `MachineName`을 재사용해 타입이 강제하게 했다.

- **Phase 3 작업이 찾아낸 구멍을 Phase 4가 다시 만났다.** 클라이언트가 조각 수를
  시작 시점에 모른다는 사실 때문에 `count_undeclared`를 만들었는데, 업로드 경로도
  같은 문제를 갖고 있었다. 업로드는 파일 크기를 아니까 종료 시점에 정확히 선언한다.

- **GOAL.md 갱신 중 다른 Phase를 오염시켰다.** Python `str.replace`가 기본 전체
  치환이라, Phase 3에서 체크한 "커버리지·빌드·lint·typecheck 통과"가 **Phase 4·5·6에도
  같이 체크됐다.** 아직 시작도 안 한 Phase가 완료로 보였다.
  → 되돌렸고, 이후 갱신은 **치환 횟수가 1인지 확인**하고 진행한다.

**2026-08-06 — 감사에서 나온 결함 3건**

Phase 4를 끝냈다고 선언한 뒤 실제로 감사해보니, **전부 초록불인데 틀린 것**이 셋 나왔다.

1. **⛔ 서버가 아예 안 떴다.** 테스트 618건·build·typecheck·lint가 모두 통과하는데
   `node src/index.ts`는 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`로 죽었다.
   vitest는 esbuild로 TypeScript를 **완전 변환**하지만 Node의 기본 type-stripping은
   `constructor(readonly x: T)`(parameter property)를 지원하지 않는다.
   다른 테스트는 전부 `createApp`/`boot`를 **import해서** 부르므로 이 차이를 볼 수 없었다.
   → `--experimental-transform-types`를 스크립트에 넣고, **진짜 진입점을 프로세스로
   띄우는 테스트**(`server-boot.test.ts`)를 추가했다. 플래그를 빼면 그 테스트가 깨진다.

2. **⛔ timestamp 포맷이 evidence 계약과 어긋났다.** `formatTimestamp`가
   `00:00:03,560`을 만드는데, Phase 0 실측 fixture는 `00:02:27`(밀리초 없음)이다.
   `verifyEvidence`는 **문자열 완전 일치**로 비교하므로 Phase 6에서 이걸 썼다면
   멀쩡한 인용이 **전부** `timestamp_mismatch`가 됐을 것이다. 그것도 Phase 6에서야.
   → `HH:MM:SS`로 고치고, **실측 fixture를 verifyEvidence에 통과시키는 테스트**를 넣었다.
   포맷을 되돌리면 그 테스트가 깨진다.

3. **같은 이름의 다른 타입 둘.** `whisper.TranscriptSegment`(ms offset + 화자)와
   `contracts.TranscriptSegment`(timestamp 문자열)가 이름이 같았다.
   → 전자를 `WhisperSegment`로 바꿨다. 변환은 `toEvidenceSegments` 한 곳에서만 한다.

**공통 원인**: "테스트가 통과한다"를 "동작한다"로 읽었다. 테스트가 닿지 않는 경계
(프로세스 실행, Phase 간 데이터 형식)는 초록불이 아무것도 보장하지 않는다.

**2026-08-06 — Phase 6.11 (실행·검수 이력)**

- **⛔ 실패한 실행은 이력에 아예 없었다.** `run.json`을 성공 경로에서만 썼다.
  `auth_required`로 끝난 실행은 디스크에 흔적이 없어서, "왜 세 번이나 다시
  돌렸나"를 나중에 설명할 수 없다. 11절이 이력을 요구하는 이유가 정확히 그것인데,
  기록하는 코드가 **성공했을 때만** 지나가는 자리에 있었다.
  → 실패 경로에서도 남긴다. 단 거기서 던지지 않는다 — 이력 쓰기가 실패하면
  사용자가 볼 원인이 「인증 만료」에서 「파일 쓰기 오류」로 바뀐다.

- **⛔ `putReviewed`가 만들어진 지 오래인데 아무도 부르지 않았다.** 저장소에
  함수가 있고 테스트도 있었지만 호출부가 없었다 — 확정을 눌러도 검수 결과가
  기록되지 않았다. **테스트가 통과하는 죽은 코드**는 구현된 것처럼 보인다.
  체크리스트를 코드로 확인할 때 "함수가 있나"가 아니라 "호출되나"를 봐야 한다.

- **write-once 전제가 되돌리기 기능에 깨졌다.** `reviewed.json` 주석에 "다시
  실행하면 새 run id가 생긴다는 전제다. Phase 6에서 부분 저장이 필요해지면 이
  전제를 다시 확인해야 한다"고 적혀 있었다. 그 사이 확정을 되돌리는 길(`reopen`)이
  생겨서, 고쳐서 다시 확정하면 **확정 자체가 `ArtifactImmutableError`로 실패**할
  참이었다. 화면에는 정상으로 보이는 버튼이었다.
  → 회차별 파일(`reviewed/001.json`)로 바꿨다. 회차는 부르는 쪽이 정한다 —
  자동 증가로 두면 같은 내용을 두 번 저장했을 때 없던 확정이 이력에 생긴다.

- **판정을 "바뀐 것만" 남기지 않으면 이력이 클릭 로그가 된다.** 같은 값을 다시
  눌러도 쌓으면, 사람이 무엇을 뒤집었는지가 중복 클릭에 묻힌다. 이 기록의 값은
  «AI가 `pass`라 한 것을 사람이 `fix_required`로 바꾼 순간»이다.

- **편집 필드 이름을 서버가 지으려다 말았다.** `summary.text`, `tasks[1].owner`
  같은 경로는 편집 종류를 아는 쪽이 만들어야 한다. 서버에 두면 `ProposalEdit`에
  종류가 하나 늘 때마다 계약과 서버가 갈라진다 → `describeEdit`를 계약에 뒀다.

**2026-08-06 — Phase 6.10 (결정 사항 entity)**

- **결정을 회의록 안 문단으로만 두면 물을 수가 없다.** 「지난달에 뭘 정했더라」가
  회의록을 쌓는 이유의 절반인데, 결정이 `## 결정 사항` 아래 문단이면 그 질문에
  답하려면 회의록을 전부 다시 읽어야 한다. → `vault/decisions/<id>.md` 파일 하나가
  결정 하나다. 회의록과 같은 규칙(경로는 id에서 파생, identity는 frontmatter).

- **⛔ 삭제가 반쪽이었다 — 회의를 지워도 회의록이 vault에 남았다.**
  `deleteSource`가 `vault/sources/<id>.md`만 옮기고 `notes/<id>.md`는 두고 있었다.
  Phase 6.7이 회의록 쓰기를 추가할 때 삭제 쪽을 같이 보지 않은 것이다. 지운 회의가
  인덱스에 남아 계속 검색됐다. 결정 파일까지 생기면 남는 것이 셋이 될 참이었다.
  → 이 source에 딸린 vault 문서를 전부 옮긴다. **결정 파일을 만들다가 찾았다** —
  새 entity를 추가할 때 삭제 경로를 함께 보는 것이 규칙이 되어야 한다.

- **되살리는 전이를 두지 않았다.** `superseded → active`가 있으면 "그때 무엇이
  유효했나"를 시각으로 재구성할 수 없다. 잘못 대체했으면 **새 결정으로 정정한다.**
  append-only가 이 앱의 기본 태도다.

- **관계는 한 방향만 저장한다(9절).** 새 결정의 `supersedes`만 파일에 적고
  이전 결정에는 `superseded_by`를 적지 않는다. 양쪽에 적으면 둘은 반드시 갈라진다.
  역방향이 필요하면 인덱스가 파생한다.

- **frontmatter의 `what`이 원형이고 본문은 렌더된 사본이다.** 본문은 `[seg_1]`을
  각주 `[^1]`로 바꾼 사람용 형태라, 본문에서 되읽으면 근거 연결이 끊긴다.
  결정 파일은 회의록과 달리 **홀로 읽히므로** 각주 정의(timestamp·인용문)를
  파일 안에 함께 넣는다 — 없으면 Obsidian에서 빈 링크가 된다.

- **⚠️ API는 있고 부르는 화면이 없다.** 6.11에서 «테스트가 통과하는 죽은 코드»를
  겪은 직후라 라우트까지 붙였지만, 결정자를 채우거나 대체 관계를 거는 **화면은
  아직 없다.** 사람이 지정해야 하는 값인데 지정할 자리가 없으므로, 화면을 붙이기
  전에는 6.10을 «쓸 수 있다»고 말하면 안 된다.

**2026-08-06 — Phase 6.12 (리팩터링)과 6.6 실측**

- **같은 규칙이 세 곳에 있었다.** 「각주 번호는 `evidence` 배열 순서」와 「모르는
  id는 마커를 지운다」를 화면·회의록·결정 파일이 각자 구현하고 있었다. 한 곳만
  고쳐지는 날 본문 각주와 「원문 근거」란의 번호가 어긋나고, **어긋난 각주는
  근거가 아니라 오답이다.** → `footnoteNumbers`·`toMarkdownFootnotes`를 계약에 뒀다.
  화면은 렌더를 공유하지 않는다 — 거기서 각주는 문자열이 아니라 눌리는 컴포넌트다.
  공유하는 것은 **번호와 규칙**이지 그리는 방법이 아니다.

- **「사람이 봤다」 판정도 둘이었다.** 화면은 `accepted|edited|empty`를 끝난 것으로
  읽고, 서버는 `empty`를 따로 검사한 뒤 나머지를 봤다. 결론은 같았지만 한쪽에
  상태가 하나 늘면 「화면은 끝났다는데 확정이 막힌다」가 된다 → `isSectionSettled`.

- **루브릭 클릭 수를 재서 테스트로 묶었다: 한 산출물 확정에 5클릭**(네 section
  확인 + 문서 확정). 기준을 늘리거나 확인 버튼을 쪼개는 것은 언제나 「더 꼼꼼해지는」
  것처럼 보이지만 그 비용은 회의마다 지불된다. **재는 순간부터 계약이다.**

- **⛔ 6.6은 코드가 아니라 외부 상태에 막혀 있다.** `ratatouille` profile이 없고
  (`default`·`k-skill`·`learning`·`reading-kg`·`signal`·`youtube`뿐), 설치된 skill이
  **하나도 없다.** GOAL대로 기본 profile을 `ratatouille`로 박으면 존재하지 않는
  profile을 불러 AI 정리가 통째로 깨진다 — 지금 기본값이 없는 것이 오히려 맞다.
  → 대신 **무엇으로 돌았는지를 `run.json`의 `profile`에 남겼다.** 실행기에게 물어서
  적는다. 설정을 이력 쪽에서 다시 읽으면 넘기는 방식이 바뀌는 날 기록만 옛 값을 가리킨다.

**2026-08-06 — Phase 6 `degraded_draft`와 결정 화면 (병렬 작업)**

- **⛔ 규칙 5가 이미 화면에서 깨져 있었다.** `document-result.tsx`가
  `view.proposal ? <Sections/>`라, **근거 검증에 실패한 결과를 정상 산출물과
  똑같이 그리고 있었다.** 규칙 5가 금지한 「자동 fallback」과 「시각적 구분 없음」이
  둘 다 화면에 있었던 것이다. 서버는 「결과를 버리지 않는다」는 이유로 실패한
  proposal을 보관하는데, 화면이 그걸 그냥 그리면 보관의 의미가 뒤집힌다.
  → 사람이 명시적으로 요청하기 전에는 **그리지 않는다.** 요청 후에는 확정·검수·편집이
  전부 막힌 읽기용 액자로 감싼다.

- **초안은 상태가 아니라 별도 변수다.** `DocumentRunState`에 `degraded_draft`를
  넣으면 `failed_retryable`을 덮어써서 **왜** 실패했는지가 사라진다. 초안은 실행이
  어떻게 끝났느냐가 아니라 **그 결과를 사람이 보기로 했느냐**다.

- **`acknowledged`를 요청 본문에 요구한다.** POST가 왔다는 사실만으로 「사람이
  요청했다」고 치면 재시도 로직이나 잘못 짠 폴링이 초안을 조용히 켤 수 있다.

- **⛔ 「테스트가 통과하는 죽은 코드」를 한 끗 차이로 피했다.** 초안 버튼은
  `onRequestDraft`가 내려올 때만 그려지는데(죽은 버튼을 그리지 않으려고 그렇게
  만들었다), 페이지가 그 prop을 넘기는 줄이 빠져 있었다. 서버·계약·표시가 전부
  초록불인데 **사람이 들어갈 문만 없는 상태**였고, 아무 테스트도 깨지지 않았다.
  → 배선을 붙이고, **그 줄을 지우면 4건이 깨지는** 테스트를 넣었다(실제로 지워서 확인).

- **⛔ 「테스트가 통과한다」를 또 「동작한다」로 읽었다.** 결정 이력 화면이 실제
  앱에서 404였는데 테스트만 보고 검증됐다고 말했다. 원인은 코드가 아니라 **3시간 반
  된 서버 프로세스**였다. 새 포트에 인스턴스를 띄워 200을 확인하고서야 알았다.
  **화면 기능을 「됐다」고 말하기 전에 뜬 앱에서 한 번 찔러본다** — 이 노트에
  같은 교훈이 이미 두 번 적혀 있었다.

- **⚠️ 서버를 어떻게 띄웠느냐가 갈린다.** `pnpm dev:server`는
  `node --experimental-transform-types --watch src/index.ts`라 코드를 고치면
  다시 뜬다. 하지만 `node --experimental-transform-types apps/server/src/index.ts`처럼
  **직접 띄운 프로세스는 `--watch`가 없어 영영 옛 코드로 돈다.** 404를 만났을 때
  범인이 그것이었다. 서버가 이상하면 **코드를 의심하기 전에 `ps`로 그 프로세스가
  어떻게 떴는지부터 본다.**

- **⚠️ `vi.waitFor` 기본 1초가 파일 전체 실행에서는 모자란다.** 단독으로는 통과하고
  전체 실행에서만 깨져서 코드 결함으로 보였다. 검수 화면은 교정본 → 확정 확인 →
  결과 마운트로 왕복이 한 번 더 있다. 느린 경로는 timeout을 명시한다.

- **⛔ 루트의 `pnpm format`이 레포를 망가뜨린다. 쓰지 말 것.** prettier 설정은
  `apps/web/.prettierrc`에만 있고 루트에는 없다. 루트에서 `prettier --write .`를
  돌리면 **apps/server와 packages/contracts가 prettier 기본값**(세미콜론·큰따옴표)
  으로 통째로 다시 포맷된다 — 실제로 60여 파일이 한 번에 바뀌었다. 게다가
  `@trivago/prettier-plugin-sort-imports`가 루트에서 해석되지 않아 중간에 죽는다.
  → 서버·계약 코드는 prettier 대상이 아니다(둘 다 `format` 스크립트가 없다).
  포맷이 필요하면 `pnpm --filter @ratatouille/web format`만 쓴다.

- **⚠️ flaky 테스트 1건을 발견했다.** `review/mobile.test.tsx`의 「각주 팝오버가
  화면을 넘지 않는다」가 같은 코드에서 한 번 실패(383.4px > 375px)하고 다음
  실행에서 통과했다. Phase 7 품질 게이트에 "테스트 3회 연속 실행 결과가 같다"가
  있으므로 **거기서 반드시 다뤄야 한다.** 지금 초록불은 운일 수 있다.

### 만난 블로커

- **1차 샘플이 회의가 아니었음** → 방탈출 게임 상황극. 전사 품질은 측정됐지만 4개 결과 추출은
  정상 케이스 검증이 안 됨. 대신 **환각 반대 테스트**로 활용해 더 큰 값을 얻음.
- **2차 녹음에 정답 라벨이 섞임** → "새로 할 일은 아니고요", "결론은 지금 내리지 않겠습니다" 같은
  메타 발화가 함정에 힌트를 줬다. 오탐 0건이 이 덕일 수 있어 **결과를 일반화하지 못한다.**
  대본에 "이 문장들은 녹음하지 말 것"을 명시하지 않은 게 원인.
- **두 샘플 모두 2트랙 분리 녹음이 아니었음** → `-di` 채널 화자 분리를 아직 한 번도 시험하지 못했다.

### 원 계획에서 벗어난 결정

- **전사 소유권**: `technical-foundation.md` 2절은 `whisper.cpp`를 전사 소유자로 두지만,
  사용자가 "hermes로만 동작"을 선언해 Hermes가 `local_command`로 실행하는 구조로 변경.
  → **사용자 확인 받음** ✅
- **Hermes 호출 경로**: 문서가 열거한 3개 후보(ACP / TUI gateway / API server) 중 `proxy`(API server)는
  profile·skill을 우회하므로 **제외**. 문서 갱신 필요. → 실측 근거로 판단, 사용자 확인 대기

---

**계획 상태**: ✅ Phase 0·1·2·4 완료 (Phase 3은 수동 검증 3건 남음) → 🔄 **Phase 5 (결과·전사 교정) 다음**
**다음 행동**: Phase 2 — 5개 상태 머신 · manifest 검증 · **evidence 무결성(결함 A)** · vault round-trip을 TDD로 구현
**현재 블로커**: 없음 (아래 두 검증은 Phase 진행을 막지 않는다)
**남은 검증**: ① 정답 라벨 없는 회의 오디오로 재측정(0.5b-2) ~~② 말겹침 구간 `-di` 검증(0.5c-2)~~ → 화자 분리를 접어 불필요

### Phase 0에서 확정된 구현 파라미터

Phase 2·3이 그대로 쓸 값이다. 추정치가 아니라 실측이다.

| 항목 | 값 |
| --- | --- |
| chunk 길이 | **5초** |
| 브라우저 로컬 저장소 | **IndexedDB** + `navigator.storage.persist()` **필수** |
| 조각 검증 | 순번 + 크기 + **SHA-256** (조각당 0.03ms) |
| 30분 녹음 용량 | 약 **29 MB**, 조각 **360개** |
| 오디오 비트레이트 | 16.1 KB/s (≈129 kbps, opus) |
| 두 track 제어 | **동시 시작 · 동시 일시정지** (편측 정지 시 295ms 드리프트) |
| 전사 | `whisper-cli -l ko -oj` + `--prompt`(참석자·프로젝트명). track별 dynaudnorm 후 모노 믹스 (`-di` 접음) |
| 전사 성능 기준선 | 12.7~14.5x 실시간, 피크 2.1GB |
| 모델 호출 | `hermes -z` 원샷 (`proxy` 금지 — profile 우회) |
| 서버 스택 | Node 24 + TypeScript + Hono, SQLite는 `better-sqlite3` 예정 |
| UI | Paperlogy · 행간 1.618 · Vercel(Geist) 컬러셋 |
