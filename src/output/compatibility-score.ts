// Display calibration only. Raw similarities remain available for ranking.
export function compatibilityPercentage(similarity: number): number {
  return Math.round(Math.sqrt(Math.min(1, Math.max(0, similarity))) * 100);
}
