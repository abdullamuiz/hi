import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Relative base keeps the build portable: Firebase Hosting, a sub-path, or a
// Capacitor webview (capacitor://localhost) all load it the same way.
export default defineConfig({
  base: './',
  plugins: [preact()],
  // Firebase is most of the bundle (~230 kB gzip); that's expected.
  build: { target: 'es2020', sourcemap: true, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
});
