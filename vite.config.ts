import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

// Each build gets an id. It's compiled into the app and written to dist/version.json,
// so a running app (including an installed one with no reload button) can notice
// that a newer version has been published and offer to update.
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: 'hi-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) + '\n' });
    },
  };
}

// Relative base keeps the build portable: Firebase Hosting, a sub-path, or a
// Capacitor webview (capacitor://localhost) all load it the same way.
export default defineConfig({
  base: './',
  plugins: [preact(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Firebase is most of the bundle (~230 kB gzip); that's expected.
  build: { target: 'es2020', sourcemap: true, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
});
