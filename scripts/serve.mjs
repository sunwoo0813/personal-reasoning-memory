import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

let localPort;
try {
 localPort = readFileSync('.env.local', 'utf8').match(/^\s*PRM_PORT\s*=\s*["']?(\d+)["']?\s*$/m)?.[1];
} catch (error) {
 if (error.code !== 'ENOENT') throw error;
}
const port = process.env.PRM_PORT || localPort || '3000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PRM_PORT must be a port between 1 and 65535.');
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), process.argv[2] || 'dev', '--hostname', 'localhost', '--port', port], {
 stdio: 'inherit', env: { ...process.env, PRM_PORT: port }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
