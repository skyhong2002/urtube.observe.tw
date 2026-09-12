// Bound both response headers and body consumption. Abort alone is cooperative:
// a stalled transport must not keep a worker's execution slot forever.
export async function youtubeRequestJson<T>(
  url: URL,
  fetchImpl: typeof fetch,
  read: (response: Response) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('YouTube request timed out', 'TimeoutError');
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw controller.signal.reason;
    }
    return read(response);
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
