import { startTracker, track, type GenerationStatus, type Observation, type ObservedPhase, type TrackerState } from '../../core/shuffle/generation';
import type { GenerationObserverPort } from './adapter';
import { visible } from './dom-visibility';

/** Verified status element: data-state ∈ idle|generating|succeeded|failed, data-job-id unique per job. */
export interface GenerationProfile { selector: string; evidence: string }
const PHASES: ObservedPhase[] = ['idle', 'generating', 'succeeded', 'failed'];

/**
 * Counts successful jobs on a VERIFIED profile only. It is started lazily when an
 * auto-shuffle lease is granted and disconnected when the lease ends. It observes
 * two attributes; element replacement is picked up by the synchronous re-read in
 * status(). Settled jobs are deduplicated by job ID, so re-renders never count.
 */
export class DomGenerationObserver implements GenerationObserverPort {
  readonly supported = true;
  private observer: MutationObserver | null = null;
  private state: TrackerState | null = null;
  private observerId = '';
  constructor(private readonly document: Document, private readonly profile: GenerationProfile, private readonly newId: () => string = () => crypto.randomUUID()) {}
  get reason() { return this.profile.evidence; }
  get running() { return this.observer !== null; }

  private read(): Observation {
    const matches = Array.from(this.document.querySelectorAll(this.profile.selector)).filter(visible);
    if (matches.length !== 1) return { phase: 'missing', jobId: null };
    const element = matches[0]!;
    const phase = element.getAttribute('data-state') as ObservedPhase | null;
    const jobId = element.getAttribute('data-job-id');
    return { phase: phase && PHASES.includes(phase) ? phase : 'missing', jobId: jobId && jobId.length <= 200 ? jobId : null };
  }
  start() {
    if (this.observer) return;
    const view = this.document.defaultView;
    if (!view) return;
    this.state = startTracker(this.read());
    this.observerId = this.newId();
    this.observer = new view.MutationObserver(() => { if (this.state) this.state = track(this.state, this.read()); });
    this.observer.observe(this.document.body ?? this.document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-state', 'data-job-id'] });
  }
  stop() { this.observer?.disconnect(); this.observer = null; this.state = null; }
  status(): GenerationStatus {
    if (!this.state) this.start();
    if (!this.state) return { supported: false, reason: 'ページを監視できません', observerId: '', generating: false, completed: 0, failed: 0 };
    this.state = track(this.state, this.read());
    const missing = this.state.phase === 'unknown';
    return { supported: !missing, reason: missing ? '生成状態の要素が一意に見つかりません。自動更新を停止してください' : this.reason, observerId: this.observerId, generating: this.state.phase === 'generating', completed: this.state.completed, failed: this.state.failed };
  }
}
