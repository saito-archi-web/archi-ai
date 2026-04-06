import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_SRC = path.join(__dirname, '..', 'ロゴデザインカラー_page-0001.jpg');
const LOGO_DEST = path.join(__dirname, 'public', 'logo.jpg');

// Ensure public directory exists and copy logo
function ensurePublicDir() {
  try {
    if (!fs.existsSync(path.join(__dirname, 'public'))) {
      fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
    }
    if (fs.existsSync(LOGO_SRC)) {
      fs.copyFileSync(LOGO_SRC, LOGO_DEST);
    }
  } catch (e) { /* ignore */ }
}

ensurePublicDir();

function logoPlugin() {
  return {
    name: 'serve-logo',
    // Dev: serve logo directly from source path via middleware
    configureServer(server) {
      server.middlewares.use('/logo.jpg', (_req, res) => {
        const src = fs.existsSync(LOGO_DEST) ? LOGO_DEST : LOGO_SRC;
        if (fs.existsSync(src)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(src).pipe(res);
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    },
    // Build: copy logo to output
    generateBundle() {
      if (fs.existsSync(LOGO_SRC)) {
        this.emitFile({ type: 'asset', fileName: 'logo.jpg', source: fs.readFileSync(LOGO_SRC) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), logoPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
