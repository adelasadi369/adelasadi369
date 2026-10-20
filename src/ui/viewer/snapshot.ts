/** PNG snapshot hook: set by SnapshotRig inside the canvas, used by the toolbar. */
export const snapshot: { take: ((bg: 'white' | 'transparent') => string) | null } = { take: null };
