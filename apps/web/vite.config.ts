/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Tailscale Serve가 이 tailnet 전용 호스트를 http://127.0.0.1:5173으로
    // 프록시한다. 다른 기기에서 개발 서버에 접근하려면 이 허용 목록이 필요하다.
    // 공개 인터넷용 Funnel은 활성화하지 않았다.
    allowedHosts: ['tailnet-host.example'],
    /**
     * `/api`를 로컬 데몬으로 넘긴다.
     *
     * ⛔ 이게 없으면 원격 기기에서 `/api/health`가 **index.html을 돌려준다.**
     *    Vite가 모르는 경로를 SPA fallback으로 처리하기 때문이다. 그러면
     *    `res.json()`이 `Unexpected token '<'`로 깨지고, 원인이 서버가 아니라
     *    프록시 누락이라는 걸 알아채기 어렵다.
     *
     * ⚠️ Hono는 **127.0.0.1에만** 바인딩한다(`apps/server/src/index.ts`).
     *    tailnet 진입점은 Tailscale Serve 하나로 유지하고, 백엔드 포트를
     *    직접 열지 않는다. Funnel(공개 인터넷)은 쓰지 않는다.
     */
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.RATATOUILLE_SERVER_PORT ?? 5174}`,
        changeOrigin: true,
        // 30분 녹음의 조각 업로드가 느린 회선에서 끊기지 않도록 넉넉히 둔다
        timeout: 10 * 60_000,
      },
    },
  },
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
    // ⛔ 실제 스타일을 불러온다. 없으면 테스트가 "DOM에 있다"까지만 보고
    //    "실제로 보이는가"를 못 본다 — 각주 버튼이 높이 0이었는데 통과했다.
    setupFiles: ['./src/test-utils/setup.ts'],
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
