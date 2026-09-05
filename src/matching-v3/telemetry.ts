import { AsyncLocalStorage } from 'node:async_hooks';
export type TokenObservation = import('../youtube/ai.js').AiCallMetrics;
export const tokenObserver = new AsyncLocalStorage<(value: TokenObservation) => void>();
export const reportTokens = (value: TokenObservation) => tokenObserver.getStore()?.(value);
