/**
 * Ratatouille 공유 계약 — apps/web과 apps/server가 함께 쓰는 정식 원본.
 *
 * technical-foundation.md 5절의 5개 상태 머신은 **서로 다른 객체**다.
 * 하나의 `Source 수명주기`로 합치지 않는다.
 */

export * from './state.ts'
export * from './rules.ts'
export * from './evidence.ts'
export * from './citation.ts'
export * from './manifest.ts'
export * from './phrasing.ts'
export * from './stage.ts'
export * from './review.ts'
