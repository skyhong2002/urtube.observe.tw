import type { AsyncLimiter } from '../youtube/concurrency.js';

// Dispatch in event-loop turns, not one enormous synchronous microtask burst.
// setImmediate is an I/O yield, not a timed request throttle.
export function createDispatchLimiter(max: number): AsyncLimiter {
  let active = 0, scheduled = false;
  const queue: (() => void)[] = [];
  let head = 0;
  function schedule() {
    if (scheduled || active >= max || head >= queue.length) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      let started = 0;
      while (active < max && head < queue.length && started++ < 32) queue[head++]();
      if (head === queue.length) { queue.length = 0; head = 0; }
      schedule();
    });
  }
  return <T>(work: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; schedule(); });
    });
    schedule();
  });
}
