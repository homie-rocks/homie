import { assignMissions } from './Mission.ts';
import { createControlSequence } from './Sequence.ts';
import { openDecision } from './Decision.ts';
import { dispatchRoomCue } from './Cue.ts';

/**
 * The discoverable facade for asymmetric games. It owns no game state; each
 * call creates or evaluates the narrowly scoped primitive named by the game.
 */
export const asymmetric = Object.freeze({
  mission: Object.freeze({ assign: assignMissions }),
  controls: Object.freeze({ sequence: createControlSequence }),
  decision: Object.freeze({ open: openDecision }),
  room: Object.freeze({ cue: dispatchRoomCue }),
});
