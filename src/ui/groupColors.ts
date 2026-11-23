// Colors that tie each part of the output to its group (docs/design/UI_REDESIGN.md).
// Chosen to stay distinguishable as underlines on the dark output band and as chips on
// paper; color is never the only cue (every part also names its group).
export const GROUP_COLORS = ['#5CC8B8', '#E8B85A', '#EE8FA5', '#B4A8F2', '#7FB7F0', '#A8D672', '#F2A35E', '#D9A3E8'] as const;
export const groupColor = (index: number) => GROUP_COLORS[((index % GROUP_COLORS.length) + GROUP_COLORS.length) % GROUP_COLORS.length]!;
