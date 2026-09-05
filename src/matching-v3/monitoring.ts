import { Worker } from 'node:worker_threads';
import type { AdminSnapshot } from './monitoring-read.js';

const REFRESH_MS = 30_000;
const TIMEOUT_MS = 30_000;

// One reader per registry, shared by all admin tabs. No polling without demand,
// no overlapping scans, and no SQLite aggregation on the HTTP event loop.
export class AdminMonitoring {
  private cached?: { version: string; value: AdminSnapshot; expires: number };
  private pending?: Promise<AdminSnapshot>;
  private pendingVersion?: string;
  private stopping?: Promise<void>;
  private cancel?: () => void;
  private retryAt = 0;
  private closed = false;

  constructor(private readonly path: string, private readonly memoryRead: (version: string) => AdminSnapshot) {}

  async read(version: string): Promise<AdminSnapshot> {
    if (this.closed) throw new Error('Monitoring closed');
    if (this.cached?.version === version && this.cached.expires > Date.now()) return this.cached.value;
    if (this.pending) {
      if (this.pendingVersion === version) return this.pending;
      await this.pending;
      return this.read(version);
    }
    if (this.stopping) throw new Error('Monitoring reader is stopping');
    if (Date.now() < this.retryAt) throw new Error('Monitoring temporarily unavailable');
    this.pendingVersion = version;
    this.pending = this.load(version).then(value => {
      this.cached = { version, value, expires: Date.now() + REFRESH_MS };
      return value;
    }).catch(error => {
      // A failed database/worker must not cause every tab to spawn another scan.
      this.retryAt = Date.now() + REFRESH_MS;
      throw error;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private load(version: string): Promise<AdminSnapshot> {
    // In-memory registries cannot be opened from another thread. These are small
    // ephemeral/test databases; deployed file-backed registries always use a worker.
    if (this.path === ':memory:') return Promise.resolve().then(() => this.memoryRead(version));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./monitoring-worker.mjs', import.meta.url), {
        workerData: { path: this.path, version },
      });
      let finished = false;
      const finish = (error?: Error, value?: AdminSnapshot) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        this.cancel = undefined;
        // Native SQLite work may take time to terminate. Keep the gate held so
        // a timeout cannot leave one scan running while another starts.
        this.stopping = worker.terminate().then(() => { this.stopping = undefined; });
        if (error) reject(error);
        else void this.stopping.then(() => resolve(value!), reject);
      };
      const timeout = setTimeout(() => finish(new Error('Monitoring timed out')), TIMEOUT_MS);
      this.cancel = () => finish(new Error('Monitoring closed'));
      worker.once('message', value => finish(undefined, value));
      worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))));
      worker.once('exit', () => finish(new Error('Monitoring reader exited without a snapshot')));
    });
  }

  close(): void {
    this.closed = true;
    this.cached = undefined;
    this.cancel?.();
  }
}
