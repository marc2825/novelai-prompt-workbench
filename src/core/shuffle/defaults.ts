import type { CameraPreset, CharacterCategory, OptionPool, PromptOption, RoleDefinition, SceneTemplate, ShuffleCategory, ShuffleLibrary } from './types';

type IdFactory = () => string;
type RoleSpec = [name: string, prompt: string, interaction: RoleDefinition['interaction'], categories?: CharacterCategory[]];

/**
 * Starter templates, inserted only when the user presses the explicit button.
 * Tags follow the official multi-character examples (source#hug / target#hug /
 * mutual#hug, source#pointing at another / target#pointing). Their effect on any
 * specific model is not verified by this extension.
 */
export function createDefaultLibrary(id: IdFactory): Omit<ShuffleLibrary, 'characters'> {
  const role = ([name, prompt, interaction, categories = ['action']]: RoleSpec): RoleDefinition =>
    ({ id: id(), name, prompt, interaction, categories, side: null, allowedCharacterIds: null });
  const template = (kind: SceneTemplate['kind'], name: string, action: string, roles: RoleSpec[], tags: string[] = []): SceneTemplate =>
    ({ id: id(), name, kind, action, basePrompt: '', roles: roles.map(role), tags, requires: [], excludes: [], weight: 1, enabled: true });
  const option = (prompt: string, constraints: Partial<Pick<PromptOption, 'tags' | 'requires' | 'excludes'>> = {}): PromptOption =>
    ({ id: id(), prompt, tags: [], requires: [], excludes: [], weight: 1, enabled: true, ...constraints });
  const pool = (name: string, category: ShuffleCategory, options: PromptOption[]): OptionPool => ({ id: id(), name, category, characterIds: null, options });
  const preset = (name: string, parts: [ShuffleCategory, string][], constraints: Partial<Pick<CameraPreset, 'tags' | 'excludes'>> = {}): CameraPreset =>
    ({ id: id(), name, parts: parts.map(([category, prompt]) => ({ category, prompt })), tags: [], requires: [], excludes: [], weight: 1, enabled: true, ...constraints });
  const pose = (prompt: string): RoleSpec => [prompt, prompt, null, ['pose']];
  return {
    templates: [
      template('role', '指差す（Pointing）', '', [['指す側', 'source#pointing at another', null], ['指される側', 'target#pointing', null]]),
      template('role', 'ハグ（Hug）', 'hug', [['抱きしめる側', '', 'source'], ['抱きしめられる側', '', 'target']]),
      template('role', '抱き合う（Mutual hug）', 'hug', [['A', '', 'mutual'], ['B', '', 'mutual']]),
      template('role', '頭をなでる（Headpat）', 'headpat', [['なでる側', '', 'source'], ['なでられる側', '', 'target']]),
      template('pose', '立つ／座る', '', [pose('standing'), pose('sitting')], ['height-difference']),
      template('pose', 'ひざまずく／立つ', '', [pose('kneeling'), pose('standing')], ['height-difference']),
      template('pose', '2人とも立つ', '', [pose('standing'), pose('standing')]),
      template('pose', '2人とも座る', '', [pose('sitting'), pose('sitting')], ['seated']),
    ],
    pools: [
      pool('個別ポーズ', 'pose', ['standing', 'sitting', 'kneeling', 'leaning forward', 'looking back', 'crossed arms'].map(prompt => option(prompt)).concat(option('lying', { tags: ['lying'] }))),
      pool('表情', 'expression', ['smile', 'open mouth', 'surprised', 'blush', 'serious', 'closed eyes', 'laughing'].map(prompt => option(prompt))),
      pool('視線', 'gaze', ['looking at viewer', 'looking at another', 'looking away'].map(prompt => option(prompt))),
      pool('アングル', 'angle', [option('from above'), option('from below', { excludes: ['lying'] }), option('eye level'), option('dutch angle'), option('from side')]),
      pool('フレーミング', 'framing', [option('close-up', { excludes: ['height-difference'] }), option('upper body'), option('cowboy shot'), option('full body'), option('wide shot')]),
    ],
    cameraPresets: [
      preset('俯瞰・引き', [['angle', 'from above'], ['framing', 'wide shot']]),
      preset('あおり・全身', [['angle', 'from below'], ['framing', 'full body']], { excludes: ['lying'] }),
      preset('アップ・カメラ目線', [['framing', 'close-up'], ['gaze', 'looking at viewer']], { excludes: ['height-difference'] }),
    ],
  };
}
