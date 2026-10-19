import { defineMove } from '@homie-rocks/studio/rules';
// A board player has an anchor, not a moving avatar. Generic movement checks are N/A.
export const move = defineMove({ board() {} });
