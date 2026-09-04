export type AsyncLimiter = <T>(work: () => Promise<T>) => Promise<T>;

// Keep a single FIFO queue per external service. Worker users can all make
// progress without allowing a large import to monopolize the API or creating
// an unbounded request burst when many archives arrive together.
export function createAsyncLimiter(maxConcurrent: number): AsyncLimiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('maxConcurrent must be a positive integer');
  }
  let active = 0;
  const waiting: Array<() => void> = [];

  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await work();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
