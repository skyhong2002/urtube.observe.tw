export const DEFAULT_ENDPOINT = 'https://urtube.observe.tw/api/ingest/youtube/capture';

export function mergeQueue(queue, payload, now = Date.now()) {
  const current = Array.isArray(queue) ? queue : [];
  const existing = current.find((item) => item.payload?.sessionId === payload.sessionId);
  const replacement = {
    payload,
    attempts: 0,
    nextAttemptAt: now,
  };
  return existing
    ? current.map((item) => item === existing ? replacement : item)
    : [...current, replacement];
}

export function retryDelayMs(attempts) {
  const exponent = Math.max(0, Math.min(12, attempts - 1));
  return Math.min(6 * 60 * 60_000, 30_000 * (2 ** exponent));
}
