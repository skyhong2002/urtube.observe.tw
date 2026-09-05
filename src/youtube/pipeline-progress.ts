import type { Repository } from '../data/database.js';
import type { Profile } from '../matching-v3/model.js';
import type { MatchingStore } from '../matching-v3/store.js';
import type { WorkerOpsStatus } from '../ops-status.js';
import { PERSONAL_TAXONOMY_DEFINITION_VERSION } from './personal-taxonomy.js';

export type PipelineState = 'waiting' | 'queued' | 'running' | 'done' | 'disabled' | 'failed' | 'blocked' | 'review' | 'retained';
export interface PipelineProgress {
  id: 'metadata' | 'topics' | 'keywords' | 'v3' | 'embedding' | 'channels';
  state: PipelineState;
  done: number | null;
  total: number | null;
  detail: string;
  basis: string;
  estimatedMinutes: number | null;
}

// A fresh positive change is required for a measured ETA. Reset on new work,
// counter rollback, batch/category changes, or a gap in observation. Weak keys
// release observations when a repository is closed and no longer referenced.
export class ProgressEstimator {
  private observations = new Map<string, { at: number; done: number; total: number; basis: string; changedAt: number; rate: number | null }>();
  estimate(stage: PipelineProgress, now: number): number | null {
    if (stage.state === 'done') { this.observations.delete(stage.id); return 0; }
    if (stage.state !== 'running' || stage.done === null || stage.total === null || stage.total <= 0) {
      this.observations.delete(stage.id); return null;
    }
    const prior = this.observations.get(stage.id);
    if (!prior || prior.basis !== stage.basis || prior.total !== stage.total || prior.done > stage.done
      || now - prior.at > 120000 || now <= prior.at) {
      this.observations.set(stage.id, { at: now, done: stage.done, total: stage.total, basis: stage.basis, changedAt: now, rate: null });
      return null;
    }
    if (now - prior.at >= 5000 && stage.done > prior.done) {
      prior.rate = (stage.done - prior.done) / (now - prior.at);
      prior.at = now; prior.done = stage.done; prior.changedAt = now;
    }
    if (!prior.rate || now - prior.changedAt > 120000) return null;
    return Math.max(1, Math.ceil((stage.total - stage.done) / prior.rate / 60000));
  }
}
const estimators = new WeakMap<Repository, Map<string, ProgressEstimator>>();
export function estimatePipeline(repository: Repository, stages: PipelineProgress[], now: number, scope = 'default'): PipelineProgress[] {
  let scopes = estimators.get(repository);
  if (!scopes) { scopes = new Map(); estimators.set(repository, scopes); }
  let estimator = scopes.get(scope);
  if (!estimator) { estimator = new ProgressEstimator(); scopes.set(scope, estimator); }
  return stages.map(stage => ({ ...stage, estimatedMinutes: estimator!.estimate(stage, now) }));
}

export function describePipeline(input: {
  metadata: ReturnType<Repository['youtubeMetadataProcessingCounts']>;
  topics: ReturnType<Repository['youtubeTopicProcessingProgress']>;
  capabilities: { metadata: boolean; topics: boolean };
  worker: WorkerOpsStatus | null; workerStage: string | null;
  selectedRange?: string;
  v3Enabled: boolean; job: ReturnType<MatchingStore['status']>; profile: Profile | null;
  profileVersion: string; now: number;
}): PipelineProgress[] {
  const { metadata: m, topics, job, profile, now } = input;
  const heartbeat = Date.parse(input.worker?.heartbeatAt ?? '');
  const fresh = input.worker?.running && heartbeat <= now && now - heartbeat < 120000;
  const workState = (phase: string): PipelineState => input.workerStage === 'failed' ? 'failed'
    : fresh && input.workerStage === phase ? 'running' : 'queued';
  const row = (id: PipelineProgress['id'], state: PipelineState, done: number | null, total: number | null, detail: string, basis: string = id): PipelineProgress =>
    ({ id, state, done, total, detail, basis, estimatedMinutes: null });
  const metadataState: PipelineState = !m.videos ? input.selectedRange ? 'done' : 'waiting' : !m.videosPendingMetadata ? 'done'
    : !input.capabilities.metadata ? 'disabled' : workState('metadata');
  let topicState: PipelineState;
  let topicDetail = 'topic-classification';
  if (!topics.readiness.totalVideos) topicState = 'waiting';
  else if (topics.run?.status === 'blocked') { topicState = 'blocked'; topicDetail = 'quality-gate'; }
  else if (topics.run?.status === 'ready') { topicState = 'review'; topicDetail = 'activation-pending'; }
  else if (topics.run?.status === 'active' && topics.processed >= topics.total) topicState = 'done';
  else if (topics.run?.definitionVersion && topics.run.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION) {
    topicState = 'retained'; topicDetail = 'legacy-retained';
  } else if (!input.capabilities.topics) topicState = 'disabled';
  else if (!topics.run && !topics.readiness.ready) { topicState = 'waiting'; topicDetail = 'readiness'; }
  else topicState = workState('topics');
  if (input.selectedRange && topics.processed >= topics.total && topics.run?.status !== 'blocked') topicState = 'done';
  const rows = [
    row('metadata', metadataState, m.videos - m.videosPendingMetadata, m.videos, 'video-metadata'),
    row('topics', topicState, topics.processed, topics.total, topicDetail, `topics:${topics.run?.taxonomyVersion ?? 'new'}:${input.selectedRange ?? 'all'}`),
    row('keywords', metadataState, m.videos - m.videosPendingMetadata, m.videos, 'keyword-source'),
  ];
  const p = job?.progress;
  const v3State: PipelineState = !input.v3Enabled ? 'disabled' : !job ? 'waiting'
    : job.state === 'failed' ? 'failed' : job.state === 'done' ? 'done'
      : job.state === 'running' ? 'running' : 'queued';
  for (const [id, phase] of [['v3', 'classification'], ['embedding', 'embedding'], ['channels', 'channels']] as const) {
    const current = p?.phase === phase;
    const saved = id === 'v3' && v3State === 'done' && profile?.version === input.profileVersion ? profile : null;
    const state = v3State === 'running' && !current ? 'queued' : v3State;
    const counted = current && phase !== 'channels';
    rows.push(row(id, state, counted ? p.processed : saved?.processedVideos ?? null,
      counted ? p.total : saved?.totalVideos ?? null,
      phase === 'channels' ? 'channel-count-unavailable' : id === 'embedding' ? 'embedding-batch' : 'v3-classification',
      `${phase}:${p?.genre ?? ''}:${job?.attempts ?? 0}:${input.profileVersion}`));
  }
  return rows;
}

export function processingComplete(stages: PipelineProgress[]): boolean {
  return stages.length > 0 && stages.every(stage => stage.state === 'done' || stage.state === 'disabled');
}
