// Shared by the YouTube and matching workers. Both run long synchronous
// SQLite work on the same loop as their heartbeat timers.
// Grants one waiter's synchronous stage per event-loop turn. Plain
// setImmediate is not enough: every immediate queued before the check phase
// runs in that same phase, so 37 archives yielding together still built all
// their crystals back to back (a 72 s block on 2026-10-22) before any timer
// fired. Draining from inside the check phase defers the next waiter to the
// following turn, so heartbeat timers run between stages.
const stageWaiters: Array<() => void> = [];
let stageDrainScheduled = false;
function drainStageTurn(): void {
  const next = stageWaiters.shift();
  if (stageWaiters.length) setImmediate(drainStageTurn);
  else stageDrainScheduled = false;
  next?.();
}
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    stageWaiters.push(resolve);
    if (!stageDrainScheduled) {
      stageDrainScheduled = true;
      setImmediate(drainStageTurn);
    }
  });
}
