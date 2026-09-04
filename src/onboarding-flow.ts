import type { User } from './users.js';
import type { MatchingDimensions } from './youtube/dimensions.js';
import type { YoutubeProcessingStatus } from './youtube/processing.js';
import {
  registryCrystalEligible,
  type RegistryMatchingCrystal,
} from './youtube/registry-crystal.js';
import type { YoutubeProgressImportRow, YoutubeScanEndReason } from './youtube/types.js';

export type GuidedOnboardingStep = 'setup' | 'processing' | 'interests' | 'consent' | 'complete';
export type GuidedScanStatus =
  | 'running'
  | 'history-paused'
  | 'signed-out'
  | 'empty'
  | 'retry'
  | null;

export interface GuidedOnboardingState {
  step: GuidedOnboardingStep;
  activeStep: number;
  provisional: boolean;
  processing: YoutubeProcessingStatus;
  dimensions: MatchingDimensions;
  scanStatus: GuidedScanStatus;
}

export interface GuidedOnboardingInput {
  user: User;
  watchEvents: number;
  processing: YoutubeProcessingStatus;
  dimensions: MatchingDimensions;
  matchingCrystal: RegistryMatchingCrystal | null;
  latestScan: YoutubeProgressImportRow | null;
}

const RETRY_SCAN_REASONS: ReadonlySet<YoutubeScanEndReason> = new Set([
  'time-limit',
  'stalled',
  'segment-limit',
  'cancelled',
  'error',
  'no-receiver',
]);

function scanStatus(latest: YoutubeProgressImportRow | null): GuidedScanStatus {
  if (!latest) return null;
  if (!latest.completedAt) return 'running';
  if (latest.endReason === 'history-paused') return 'history-paused';
  if (latest.endReason === 'signed-out') return 'signed-out';
  if (latest.endReason === 'no-content' || latest.endReason === 'end-of-history') return 'empty';
  if (latest.endReason && RETRY_SCAN_REASONS.has(latest.endReason)) return 'retry';
  return null;
}

export function guidedOnboardingState(input: GuidedOnboardingInput): GuidedOnboardingState {
  const base = {
    provisional: input.processing.pending > 0,
    processing: input.processing,
    dimensions: input.dimensions,
    scanStatus: scanStatus(input.latestScan),
  };
  if (input.user.onboardingCompletedAt
    || (input.user.matchingOptIn && input.dimensions.status === 'confirmed')) {
    return { ...base, step: 'complete', activeStep: 6 };
  }
  if (input.watchEvents === 0) {
    return { ...base, step: 'setup', activeStep: 2 };
  }
  if (!input.matchingCrystal || !registryCrystalEligible(input.matchingCrystal)) {
    return { ...base, step: 'processing', activeStep: 3 };
  }
  if (input.dimensions.status !== 'confirmed') {
    return { ...base, step: 'interests', activeStep: 5 };
  }
  return { ...base, step: 'consent', activeStep: 6 };
}
