import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// An owned, loopback-only numeric service. Never attach the demo to the
// configured deployment or pass provider credentials into the subprocess.
export async function startDemoCompute(python = process.env.DEMO_PYTHON ?? 'python3') {
  const token = randomBytes(32).toString('hex');
  const child = spawn(python, ['-u', '-c', `
import sys
sys.path.insert(0, sys.argv[1])
from compute import Handler, HTTPServer
server = HTTPServer(('127.0.0.1', 0), Handler)
print(server.server_port, flush=True)
server.serve_forever()
`, fileURLToPath(new URL('../services/matching-compute', import.meta.url))], {
    env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1',
      OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', MATCHING_V3_COMPUTE_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let closed = false;
  child.once('close', () => { closed = true; });
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
  const close = async () => {
    if (closed) return;
    await new Promise<void>(resolve => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('close', () => { clearTimeout(kill); resolve(); });
      child.kill('SIGTERM');
    });
  };
  // Also clean up when the parent fails during seeding or loses its server.
  const onExit = () => { child.kill('SIGTERM'); };
  process.once('exit', onExit);
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let stdout = '';
      const timeout = setTimeout(() => reject(new Error('Demo compute startup timed out')), 30_000);
      const finish = (error?: Error, value?: number) => {
        clearTimeout(timeout);
        if (error) reject(error); else resolve(value!);
      };
      child.once('error', error => finish(error));
      child.once('exit', () => finish(new Error(`Demo compute exited. Install the pinned Python requirements and set DEMO_PYTHON. ${stderr}`)));
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
        if (!stdout.includes('\n')) return;
        const value = Number(stdout.split('\n')[0]);
        if (Number.isInteger(value) && value > 0 && value <= 65535) finish(undefined, value);
        else finish(new Error('Invalid demo compute port'));
      });
    });
    return { url: `http://127.0.0.1:${port}`, token, close: async () => {
      process.removeListener('exit', onExit);
      await close();
    } };
  } catch (error) {
    process.removeListener('exit', onExit);
    await close();
    throw error;
  }
}
