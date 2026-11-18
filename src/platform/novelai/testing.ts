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
    characters: {
      max: 6,
      selectors: {
        positive: `textarea[data-workbench-fixture="${tabId}-character-{n}-positive"]`,
        negative: `textarea[data-workbench-fixture="${tabId}-character-{n}-negative"]`,
      },
    },
    model: { selector: `[data-workbench-fixture="${tabId}-model"]` },
    generation: {
      selector: `[data-workbench-fixture="${tabId}-generation"]`,
      evidence: 'ローカルfixtureの生成状態要素（data-state / data-job-id）。実NovelAIの生成検知ではありません。',
    },
  };
}
