# 도메인 결정의 빈칸 검증 계약 조사안

> 상태: 검토 요청용 초안  
> 작성일: 2026-08-06  
> 목적: 회의에서 확인된 결정으로 도메인 문서를 보강할 때, 남은 빈칸을 항상 같은 절차로 검증하고 일정한 결과물로 만드는 방법을 정리한다.

## 1. 사용자의 원래 의도

이 문서가 해결하려는 흐름은 다음과 같다.

1. 녹음·전사에서 회의 요약과 결정 후보를 만든다.
2. 사용자가 요약과 결정이 실제 회의 내용과 일치하는지 확인한다.
3. 확인된 결정 중 도메인에 연결되는 내용만 도메인 Markdown으로 승격한다.
4. 결정만으로 확정할 수 없는 빈칸은 실무자에게 웹 폼으로 질문한다.
5. 답변을 검증하고 승인한 후에만 Brain이 사용하는 정식 도메인 문서에 반영한다.

핵심 요구는 다음 두 가지다.

- 검증 과정이 담당자나 실행 시점에 따라 달라지지 않아야 한다.
- 같은 확정 답변과 같은 버전의 규칙을 입력하면 같은 결과물이 나와야 한다.

## 2. 조사 결론

루브릭만으로는 두 요구를 모두 충족할 수 없다. 다음 네 요소를 묶은 **버전된 검증 계약(Validation Contract)**이 필요하다.

1. 질문과 답변 형식을 고정하는 스키마
2. 조건과 충돌을 기계적으로 판단하는 결정 규칙
3. 근거의 의미를 사람이 판단하는 루브릭
4. 승인된 구조화 데이터를 일정한 Markdown으로 만드는 고정 렌더러

여기서 구분해야 할 일관성은 두 종류다.

- **기계적 재현성**: 같은 입력이면 같은 JSON, hash, Markdown을 생성한다.
- **사람 판단의 일치성**: 서로 다른 실무자가 같은 근거를 보고 비슷한 판정을 내린다.

첫 번째는 코드와 테스트로 보장할 수 있다. 두 번째는 루브릭 정의, 판정 예시, 이중 검수와 검수자 캘리브레이션으로 관리해야 한다.

## 3. 권장 검증 파이프라인

```text
버전된 QuestionnaireDefinition
  -> 웹 폼 렌더링
  -> 구조화된 Response Draft
  -> JSON Schema 구조 검증
  -> 도메인 의미 규칙·결정표 검증
  -> 근거 무결성 검증
  -> 사람 루브릭 검수
  -> 승인 게이트
  -> 승인된 Decision JSON 정규화·hash
  -> 고정 Markdown 렌더러
  -> Vault 쓰기 및 Brain 재색인
```

### 3.1 질문 정의

각 질문은 표시 문구가 아니라 변하지 않는 ID로 식별한다. 질문 정의에는 최소한 다음 정보가 필요하다.

- `questionnaire_id`
- `schema_version`
- `rubric_version`
- `renderer_version`
- 질문 ID와 표시 순서
- 답변 타입, enum 코드와 화면 표시 문구
- 필수 여부
- 조건부 노출·필수 규칙
- 자동 검증 규칙
- 연결되는 도메인 rule ID

화면과 서버가 각자 별도의 검증 규칙을 가지면 시간이 지나면서 결과가 달라진다. 질문 정의는 하나만 두고 웹 UI와 서버가 같은 계약을 사용해야 한다. 클라이언트 검증은 사용성 보조이고 최종 판정은 서버가 담당한다.

JSON Schema는 타입, enum, 범위, 필수 속성, 조건부 필드를 표현하고 UI용 설명을 함께 제공할 수 있다.

- [JSON Schema 2020-12 Validation](https://json-schema.org/draft/2020-12/json-schema-validation)
- [JSON Schema 조건부 예시](https://json-schema.org/learn/miscellaneous-examples)
- [Ajv JSON Schema 지원](https://ajv.js.org/json-schema.html)
- [Ajv strict mode](https://ajv.js.org/strict-mode.html)

### 3.2 자동 구조 검증

사람이 판단할 필요가 없는 항목은 루브릭으로 만들지 않는다. 서버에서 다음을 자동 검사한다.

- 필수 답변 누락
- 문자열·정수·날짜·enum 타입
- 날짜와 숫자의 허용 범위
- 빈 배열과 중복 선택지
- 정의되지 않은 속성
- 조건부 필수 답변
- 질문·스키마 버전 불일치

예를 들어 `late_issue_mode = separate_process`라면 다음 항목을 모두 필수로 요구할 수 있다.

- 별도 처리 시스템 또는 메뉴
- 승인 역할
- 감사 로그 방식
- 사용자 안내문

### 3.3 도메인 의미 규칙과 결정표

JSON Schema는 단일 응답의 구조에는 적합하지만 다음과 같은 외부 상태나 여러 필드 사이의 업무 의미까지 모두 담당하기 어렵다.

- 기존 활성 결정과 새 결정의 충돌
- 이전 결정을 대체하거나 뒤집는 관계
- 근거 segment의 실제 존재 여부
- 현재 도메인 문서가 검토 시작 후 변경됐는지 여부
- 특정 발행 유형에서는 반드시 필요한 예외 처리

이 부분은 입력과 위반 목록만 반환하는 순수 TypeScript 검증 함수와 작은 결정표로 구현하는 안이 적합하다.

OMG DMN은 결정과 결정표를 정식으로 모델링하는 표준이다. 다만 현재 범위에서는 DMN XML·FEEL 실행 엔진 전체를 도입하기보다 결정표와 명시적 hit policy 개념만 차용하는 것을 권장한다.

- [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/About-DMN)

## 4. 제안 루브릭

기존 프로젝트의 판정값을 유지한다.

- `pass`
- `fix_required`
- `uncertain`
- `not_applicable`

| 기준 | `pass` 판정 조건 | 판정 방식 |
|---|---|---|
| 근거 일치 | 인용된 회의 구간이 작성된 결정 문장을 실제로 뒷받침한다 | ID·원문은 자동, 의미는 사람 |
| 결정 여부 | 제안·질문·논의가 아니라 합의 또는 권한자의 승인으로 확정됐다 | 사람 |
| 적용 범위 | 대상 업무, 화면, 발행 유형과 제외 대상이 명시됐다 | 자동 + 사람 |
| 경계값 명확성 | 포함 여부, 시간대, 단위, 휴일 처리 등 경계가 명확하다 | 자동 + 사람 |
| 예외 완결성 | 예외 조건, 처리 경로, 승인자, 기록 방식이 있다 | 자동 + 사람 |
| 기존 규칙 충돌 | 활성 규칙과 충돌하지 않거나 대체·철회 관계가 명시됐다 | 자동 |
| 시행 책임 | 결정권자, 승인자, 시행일 또는 적용 버전이 명시됐다 | 자동 + 사람 |
| 외부 규정 구분 | 회사 내부 정책과 법령·세무 규정이 구분되고 외부 출처 확인일이 있다 | 사람 |

루브릭 운영 규칙 제안:

- `uncertain`이 하나라도 남으면 게시하지 않는다.
- `fix_required`는 수정 후 다시 검증한다.
- `not_applicable`은 허용된 기준에서만 선택하고 사유를 필수로 기록한다.
- AI 판정은 초깃값이며 최종 승인이 아니다.
- 루브릭 판정과 문서의 review state는 서로 다른 상태로 유지한다.
- 객관적으로 검사 가능한 필수값을 사람의 클릭으로 대체하지 않는다.

## 5. 월간 정산 마감일 사례 (가상 예시)

> 아래 내용은 방법론을 설명하기 위한 **가상의 예시**다. 특정 회의나 조직의 실제 결정이 아니다.

가상의 회의에서 확인했다고 가정하는 내용:

- 매월 10일 이전에는 이전 달 정산 기준일을 선택할 수 있도록 한다.
- 10일이 지나면 이전 달 선택을 막는다.
- 선택할 수 없는 이유를 화면에 안내한다.
- 불이익 가능성이 있는 늦은 처리는 기본 화면에서 막고 별도 확인 후 처리한다.

이 내용에서 과도한 추론 없이 실무자에게 확인해야 할 빈칸은 다음과 같다.

1. 10일 당일도 이전 달 기준일을 선택할 수 있는가?
2. 기준 시간대는 `Asia/Seoul`인가?
3. 10일이 휴일이면 마감일을 이동하는가?
4. 일반 처리, 대량 처리, 수정 처리에 같은 규칙을 적용하는가?
5. 차단은 화면에서만 하는가, 서버 API에서도 강제하는가?
6. 늦은 처리를 담당하는 별도 시스템·메뉴는 무엇인가?
7. 늦은 처리의 승인 역할과 감사 기록 방식은 무엇인가?
8. “불이익 가능성”은 내부 운영 판단인가, 확인된 외부 기준인가?

이 질문들은 답을 미리 가정하지 않는다. 예를 들어 원문에는 “10일 이전”과 “10일이 지나면”이 함께 있어 10일 당일 포함 여부가 확정되지 않았으므로 반드시 빈칸으로 유지해야 한다.

## 6. 게시 게이트

최종 게시 여부는 UI가 아니라 서버의 단일 함수로 파생한다.

```text
publishable =
  schema.valid
  AND semanticRules.valid
  AND evidence.valid
  AND blockingRubricItemsArePass
  AND noUncertainItems
  AND currentDomainHash == reviewedBaseDomainHash
  AND approvedByAuthorizedUser
```

어떤 화면이나 API 경로에서 요청해도 동일한 게시 함수를 통과해야 한다. AI가 직접 `current` 또는 Brain 반영 상태로 승격하는 경로는 두지 않는다.

## 7. 결과물 재현성

실무자의 답변은 Markdown이 아니라 구조화된 JSON으로 먼저 저장한다.

- enum은 화면 문구가 아닌 고정 코드로 저장한다.
- 문자열은 공백, 개행, Unicode 정책에 따라 먼저 정규화한다.
- 날짜와 시간대 표현을 고정한다.
- 승인된 JSON의 속성 직렬화 순서를 정규화한다.
- Markdown 섹션과 항목 순서는 renderer version에 고정한다.
- 같은 승인 JSON과 같은 renderer version은 byte-identical Markdown을 생성해야 한다.
- 외부에서 도메인 Markdown이 변경되면 기존 base hash를 가진 게시 요청은 충돌로 막는다.

JSON hash의 재현에는 JSON Canonicalization Scheme을 사용할 수 있다.

- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)

현재 `apps/server/src/runs/store.ts`의 `canonical()`은 `JSON.stringify` 결과를 그대로 사용한다. 이 방식은 의미가 같은 객체라도 속성 구성 순서가 다르면 동일 hash를 보장하는 정식 canonicalization은 아니다.

## 8. 출처와 승인 이력

전체 W3C PROV RDF 모델을 도입하지 않고 다음 최소 필드만 차용할 수 있다.

- entity: 결정 ID와 revision
- activity: 질문 응답, 검수, 승인, 게시
- agent: 응답자와 승인자
- source: 회의, transcript revision, evidence segment
- version: schema, rubric, renderer
- relation: `supersedes`, `reverses`
- timestamps: 응답, 검수, 승인, 게시 시각

- [W3C PROV-O](https://www.w3.org/TR/prov-o/)

## 9. 사람 판정의 일관성 검증

같은 답변에서 같은 파일을 만드는 것은 테스트로 보장할 수 있지만, 서로 다른 검수자가 같은 의미 판정을 내리는 것은 별도로 측정해야 한다.

초기 운영안:

1. 실제 결정 표본을 두 명이 독립적으로 검수한다.
2. 기준별 불일치와 불일치 이유를 수집한다.
3. 모호한 정의와 경계 사례를 루브릭 예시에 추가한다.
4. `rubric_version`을 올리고 같은 표본을 다시 검수한다.
5. 운영 중 일부 표본을 정기적으로 이중 검수한다.

두 검수자의 범주형 판정에는 Cohen's kappa를, 검수자가 여러 명이거나 누락값이 있는 경우에는 Krippendorff's alpha를 검토할 수 있다. 구체적인 합격 기준은 실제 표본을 본 뒤 팀 정책으로 고정해야 하며, 임의의 수치를 보편 기준으로 단정하지 않는다.

- [Cohen, A Coefficient of Agreement for Nominal Scales](https://doi.org/10.1177/001316446002000104)
- [Krippendorff's alpha 설명](https://journal.r-project.org/articles/RJ-2021-046/)

## 10. 테스트 제안

1. 유효·무효 JSON Schema fixture
2. 날짜 경계값 테스트: 9일, 10일, 11일과 당일 포함 여부
3. 조건부 필수값 테스트: 별도 처리 선택 시 승인자·시스템 누락
4. 결정표 조합 테스트: 유한 enum 조합의 누락·중복 규칙 확인
5. evidence ID·timestamp·quote 무결성 테스트
6. 기존 활성 결정과의 충돌 및 `supersedes`·`reverses` 테스트
7. stale base hash 게시 거부 테스트
8. 동일 입력 재게시의 idempotency 테스트
9. 승인 JSON에서 생성한 Markdown golden file 테스트
10. 이전 schema·rubric·renderer version 결과를 새 버전으로 조용히 재해석하지 않는 migration 테스트

## 11. 현재 프로젝트와 맞는 부분

프로젝트에는 이미 다음 기반이 있다.

- `proposed.json -> schema 검증 -> Markdown` 계획
- `pass / fix_required / uncertain / not_applicable` 루브릭 판정
- AI 초깃값과 사용자 최종 승인의 분리
- evidence segment 무결성 검증
- source hash 불일치 시 덮어쓰기 차단
- append-only run artifact
- `schema_version`, `rubric_version` 기록
- 결정의 `active / superseded / reversed` 상태

따라서 별도의 범용 설문 플랫폼을 만드는 것보다 기존 검수 계약에 다음을 확장하는 안이 자연스럽다.

1. 버전된 `QuestionnaireDefinition`
2. 서버 권위의 JSON Schema validator
3. 작은 TypeScript 의미 결정표
4. 도메인 결정 전용 사람 루브릭
5. canonical Decision JSON과 고정 Markdown renderer

## 12. 범위에서 제외할 것을 권장하는 고도화

현재 요구만으로 다음을 즉시 도입할 필요는 확인되지 않았다.

- 전체 DMN XML·FEEL 런타임
- OPA·Rego 정책 서버
- W3C PROV RDF·OWL 저장소
- 범용 no-code 폼 빌더
- 별도의 설문 SaaS 연동
- AI의 자동 최종 승인
- 통계 지표만으로 실무 결정의 진실성을 판정하는 기능

이 항목들은 규칙 규모, 비개발자의 규칙 편집 요구, 외부 시스템 간 정책 공유 등 실제 필요가 생겼을 때 다시 검토한다.

## 13. 확인이 필요한 제안과 가정

다음 내용은 회의에서 이미 확정된 요구가 아니라 이번 조사에서 제안한 설계이므로 사용자 확인 없이 확정 사양으로 취급하면 안 된다.

- JSON Schema 2020-12와 Ajv를 canonical questionnaire validator로 선택하는 것
- 의미 규칙을 TypeScript 결정표로 구현하는 것
- RFC 8785 방식으로 JSON hash를 정규화하는 것
- 이중 검수와 검수자 일치도 지표를 운영 절차에 포함하는 것
- 출처 이력에 W3C PROV의 최소 개념을 차용하는 것
- 5절 가상 예시의 빈칸 8개 같은 목록을 모두 필수 질문으로 채택하는 것

## 14. 리뷰 요청

다음 관점만 우선 검토한다.

1. 사용자의 실제 의도에서 벗어난 해석이나 요구 확장이 있는가?
2. 회의에서 확정되지 않은 내용을 확정 사실처럼 서술한 부분이 있는가?
3. 현재 문제를 해결하는 데 의미가 없는 고도화가 포함됐는가?
4. JSON Schema, 결정표, 루브릭, 고정 렌더러 중 더 단순하게 줄일 수 있는 부분이 있는가?
5. 필요한 검증이 빠져 있어서 결과 일관성이 깨질 수 있는 부분이 있는가?

리뷰 결과는 `유지 / 단순화 / 제거 / 사용자 확인 필요`로 분류하고, 지적마다 근거 문단을 함께 제시한다.
