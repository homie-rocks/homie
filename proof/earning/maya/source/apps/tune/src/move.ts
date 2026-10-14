// The current rules contract requires a move for a participant, even without an avatar.
import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({ participant() {} });
