// Starts the Emulator Suite, re-importing data saved by the previous run (if any).
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const dir = '.emulator-data';
const args = ['firebase', 'emulators:start', '--project', 'demo-drops', `--export-on-exit=${dir}`];
if (existsSync(`${dir}/firebase-export-metadata.json`)) args.push(`--import=${dir}`);
const p = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => p.kill(sig));
p.on('exit', (code) => process.exit(code ?? 0));
