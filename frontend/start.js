// 依存パッケージをインストールしてからVite開発サーバーを起動するスクリプト
const { execSync, spawn } = require('child_process')
const path = require('path')

console.log('📦 パッケージをインストール中...')
try {
  execSync('npm install', { stdio: 'inherit', cwd: __dirname })
} catch (e) {
  console.error('npm install に失敗しました:', e.message)
  process.exit(1)
}

console.log('🚀 Vite 開発サーバーを起動中...')
const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite'],
  { stdio: 'inherit', cwd: __dirname }
)

vite.on('exit', (code) => process.exit(code))
