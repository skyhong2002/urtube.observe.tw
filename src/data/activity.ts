import { createHash } from 'node:crypto';
import type { Activity, ActivityTimePrecision, MediaEntry } from './types.js';

function canonical(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function parseOccurredAt(value: string): { value: string | null; precision: ActivityTimePrecision } {
  if (!value) return { value: null, precision: 'unknown' };
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T/;
  if (isoDate.test(value) || isoDateTime.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return { value: parsed.toISOString(), precision: isoDate.test(value) ? 'day' : 'exact' };
    }
  }
  return { value, precision: 'label' };
}

export function activityFromEntry(entry: MediaEntry, seenAt = new Date().toISOString()): Activity {
  const occurred = parseOccurredAt(entry.activityAt);
  // A manually recorded event is one durable item: editing its date or moving
  // it from upcoming to attended updates the same entry. Synced media sources
  // still retain distinct progress/completion moments.
  const identity = entry.source === 'events' && entry.sourceItemId
    ? [entry.source, entry.sourceItemId]
    : entry.sourceItemId
    ? [entry.source, entry.sourceItemId, entry.activityAt, entry.status ?? '']
    : [entry.source, entry.kind, canonical(entry.title), entry.activityAt, entry.status ?? ''];
  const dedupeKey = identity.join('\u001f');
  const id = createHash('sha256').update(dedupeKey).digest('hex');
  return {
    id,
    dedupeKey,
    source: entry.source,
    sourceItemId: entry.sourceItemId ?? null,
    type: `${entry.kind}.${entry.status || 'activity'}`,
    mediaKind: entry.kind,
    title: entry.title,
    image: entry.image,
    status: entry.status || null,
    occurredAt: occurred.value,
    occurredAtPrecision: occurred.precision,
    rating: entry.rating,
    visibility: entry.visibility ?? 'public',
    extra: entry.extra,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  };
}
