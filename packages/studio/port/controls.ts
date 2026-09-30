/*
 * One input for keys AND touch, in screen space. A port that writes its own
 * input (rather than letting the touch kit press the game's keys) reads this:
 *
 *   const input = createControls({ actions: { jump: ['Space', 'KeyW'] }, touch: { buttons: [{ id: 'jump', label: 'JUMP' }] } });
 *   const m = input.move();          // x right, y DOWN, length ≤ 1 (WASD, arrows or the stick)
 *   if (input.pressed('jump')) …     // once per press, from a key or a touch button
 *
 * Map `move()` to the world with the camera's screen axes (camera.ts), never
 * with the character's facing.
 */
import { createKeys } from './keys';
import { createTouchControls, type TouchControls, type TouchOptions } from './touch';

export interface ControlsOptions {
  /** Action → key codes (desktop) that trigger it. A touch button with the same id triggers it too. */
  actions?: Record<string, string[]>;
  touch?: TouchOptions;
}

export interface Controls {
  move(): { x: number; y: number };
  held(action: string): boolean;
  pressed(action: string): boolean;
  readonly touch: TouchControls;
  destroy(): void;
}

export function createControls(opts: ControlsOptions = {}): Controls {
  const keys = createKeys();
  const touch = createTouchControls(opts.touch ?? {});
  const actions = opts.actions ?? {};
  return {
    touch,
    move() {
      const k = keys.move(); const s = touch.stick();
      const x = k.x + s.x; const y = k.y + s.y; const len = Math.hypot(x, y);
      return len > 1 ? { x: x / len, y: y / len } : { x, y };
    },
    held(a) { return touch.held(a) || (actions[a] ?? []).some((c) => keys.down(c)); },
    pressed(a) {
      let hit = touch.pressed(a);
      for (const c of actions[a] ?? []) if (keys.pressed(c)) hit = true;
      return hit;
    },
    destroy() { keys.destroy(); touch.destroy(); },
  };
}
