export const MATCHING_DISCLOSURE_LEVELS = ['topics_only', 'topics_and_channel'] as const;
export type MatchingDisclosureLevel = typeof MATCHING_DISCLOSURE_LEVELS[number];

export interface MatchingCardDisclosure {
  topics: string[];
  channel?: string;
}

// Candidate presentation must call this server-side. A shared channel is
// disclosed only when both people opted into that level; one restrictive
// setting wins. No weights, counts, video ids, or other crystal fields cross
// this boundary.
export function matchingCardDisclosure(
  left: MatchingDisclosureLevel,
  right: MatchingDisclosureLevel,
  sharedTopics: string[],
  sharedChannels: string[],
): MatchingCardDisclosure {
  const topics = sharedTopics.slice(0, 2);
  if (left !== 'topics_and_channel' || right !== 'topics_and_channel' || !sharedChannels[0]) {
    return { topics };
  }
  return { topics, channel: sharedChannels[0] };
}
