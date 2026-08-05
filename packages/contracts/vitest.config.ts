import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      // index.ts는 재수출만 한다
      exclude: ['src/index.ts'],
      /**
       * GOAL.md Phase 2 품질 게이트:
       *   상태 머신·evidence 무결성 커버리지 ≥ 90%
       *
       * 상태 오염과 깨진 근거 링크가 이 제품의 가장 위험한 실패 모드다.
       * 임계값을 게이트로 고정해 회귀를 막는다.
       */
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
})
