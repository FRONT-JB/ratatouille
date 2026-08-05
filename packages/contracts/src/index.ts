/**
 * Ratatouille 공유 계약
 *
 * apps/web과 apps/server가 함께 쓰는 상태 enum과 API 타입의 정식 원본.
 *
 * ⚠️ technical-foundation.md 5절 `분리된 처리 상태`의 5개 상태 머신은
 *    **서로 다른 객체**다. 하나의 `Source 수명주기`로 합치지 않는다.
 *    실제 전이 함수와 검증은 Phase 2에서 TDD로 구현한다 — 여기는 뼈대만 둔다.
 */

export const CONTRACTS_VERSION = '0.0.0'
