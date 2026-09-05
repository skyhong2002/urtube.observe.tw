// Credentials stay in memory; callers must never log this pool or request headers.
export class GeminiKeyPool {
  private cursor = 0;
  private entries: { key: string; until: number; disabled: boolean }[];
  constructor(keys: string[], private now = Date.now) {
    this.entries = [...new Set(keys.filter(Boolean))].map(key => ({ key, until: 0, disabled: false }));
  }
  async request(send: (key: string) => Promise<Response>): Promise<Response | null> {
    const tried = new Set<number>();
    while (tried.size < this.entries.length) {
      let index = -1;
      for (let offset = 0; offset < this.entries.length; offset++) {
        const i = (this.cursor + offset) % this.entries.length, entry = this.entries[i];
        if (!tried.has(i) && !entry.disabled && entry.until <= this.now()) { index = i; break; }
      }
      if (index < 0) return null; // Worker retries later; never busy-loop while all keys cool down.
      this.cursor = (index + 1) % this.entries.length;
      tried.add(index);
      const entry = this.entries[index];
      const response = await send(entry.key);
      if (response.status === 401 || response.status === 403) {
        entry.disabled = true;
        await response.body?.cancel();
        continue;
      }
      if (response.status !== 429) return response;
      // Immediately mark cooling before reading RetryInfo so concurrent calls skip it.
      entry.until = Math.max(entry.until, this.now() + 60000);
      const header = response.headers.get('retry-after');
      let delay = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - this.now()) : 0;
      try {
        const body = await response.json() as { error?: { details?: { retryDelay?: string }[] } };
        for (const detail of body.error?.details ?? []) {
          if (typeof detail.retryDelay === 'string' && /^\d+(\.\d+)?s$/.test(detail.retryDelay)) delay = Math.max(delay, parseFloat(detail.retryDelay) * 1000);
        }
      } catch { /* An unreadable provider body must not leak to logs. */ }
      if (Number.isFinite(delay)) entry.until = Math.max(entry.until, this.now() + delay);
    }
    return null;
  }
  get allDisabled() { return this.entries.length > 0 && this.entries.every(entry => entry.disabled); }
}
