// Synthetic selectors, imported only by local tests. Never a live NovelAI profile.
import type { VerifiedTextareaProfile } from './dom';

export function fixtureProfile(tabId: 101 | 202): VerifiedTextareaProfile {
  return {
    id: `controlled-fixture-${tabId}`,
    evidence: 'React制御textareaのローカルfixture。実NovelAIの書込み検証ではありません。',
    selectors: {
      positive: `textarea[data-workbench-fixture="${tabId}-positive"]`,
      negative: `textarea[data-workbench-fixture="${tabId}-negative"]`,
    },
  };
}
