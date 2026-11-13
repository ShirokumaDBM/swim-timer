import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 相対パスで出力する（GitHub Pages の https://<ユーザー名>.github.io/<リポジトリ名>/ など、どの場所に置いても動く）
  base: './',
})
