import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // ホーム画面に追加できるようにし、一度開いたあとは電波がなくても画面が開くようにする。
    // 記録（ブラウザ内のデータベース）には触れない。新しい版を公開すると、次に開いたときに自動で入れ替わる
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'スイムタイマー',
        short_name: 'スイムタイマー',
        description: '水泳部のタイム測定を補助するアプリ',
        lang: 'ja',
        // 相対パスにして、どの場所に置いても動くようにする（base と同じ考え方）
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#0b5cad',
        background_color: '#f6f8fa',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
  // 相対パスで出力する（GitHub Pages の https://<ユーザー名>.github.io/<リポジトリ名>/ など、どの場所に置いても動く）
  base: './',
})
