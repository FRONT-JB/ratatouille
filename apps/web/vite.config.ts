/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    // 브라우저 테스트에서 lucide-react가 별도 React 인스턴스를 잡아
    // useContext가 null이 되는 것을 막는다
    dedupe: ['react', 'react-dom'],
    alias: {
      // `__dirname`은 native configLoader에서 지원되지 않아 경고가 난다.
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    silent: 'passed-only',
    unstubEnvs: true,
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          args: [
            // ⛔ 없으면 AudioContext가 suspended로 남아 resume()이 영영 안 풀린다.
            //    Phase 0 브라우저 실험에서 같은 이유로 실험이 멈춘 적이 있다.
            //    visualizer가 "실제 오디오에 반응"하는지 검증하려면 필수다.
            '--autoplay-policy=no-user-gesture-required',
            // 마이크 테스트용 합성 장치. 실제 하드웨어에 의존하지 않는다.
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
      exclude: [
        'src/components/ui/**',
        'src/assets/**',
        'src/routeTree.gen.ts',
        'src/test-utils/**',
        'src/routes/**',
      ],
    },
  },
})
