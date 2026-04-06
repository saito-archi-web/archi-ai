const { execSync, spawn } = require('child_process')

console.log('Installing packages...')
try {
  execSync('npm install', { stdio: 'inherit', cwd: __dirname })
} catch (e) {
  process.exit(1)
}

console.log('Starting Vite...')
const vite = spawn('npx', ['vite'], {
  stdio: 'inherit',
  cwd: __dirname,
  shell: true
})
vite.on('exit', (code) => process.exit(code ?? 0))
