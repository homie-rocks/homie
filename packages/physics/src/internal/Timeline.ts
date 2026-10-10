/**
 * Rapier's pending joint-island events are not serialized. Keep the last state
 * before a structural edit and replay subsequent commands when restoring a
 * pre-step save. After a solved step the journal is unnecessary and is dropped.
 */
export const timelineMethods = [
  "random",
  "createBody",
  "createCollider",
  "impulse",
  "setVelocity",
  "teleport",
  "moveKinematic",
  "updateBody",
  "updateCollider",
  "force",
  "torque",
  "clearForces",
  "sleep",
  "wake",
  "removeCollider",
  "removeBody",
  "createJoint",
  "removeJoint",
  "createCharacter",
  "controlCharacter",
  "removeCharacter",
  "raycast",
  "raycastAll",
  "castShape",
  "overlaps",
  "debugLines",
  "step",
] as const;
const structural = new Set<string>([
  "removeBody",
  "createJoint",
  "removeJoint",
  "removeCharacter",
]);
export interface Replay {
  checkpoint: Uint8Array;
  commands: [string, unknown[]][];
}
function clone(value: unknown): unknown {
  if (value instanceof Float32Array) return value.slice();
  if (value instanceof Uint32Array) return value.slice();
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clone(v)]),
    );
  return value;
}
export class Timeline {
  replay?: Replay;
  depth = 0;
  install(owner: object, capture: () => Uint8Array): void {
    const methods = owner as Record<string, (...args: unknown[]) => unknown>;
    for (const name of timelineMethods) {
      const original = methods[name]!.bind(owner);
      Object.defineProperty(owner, name, {
        value: (...args: unknown[]) => {
          if (this.depth) return original(...args);
          const previous = this.replay;
          if (!this.replay && structural.has(name))
            this.replay = { checkpoint: capture(), commands: [] };
          this.depth++;
          try {
            const result = original(...args);
            if (this.replay)
              this.replay.commands.push([name, clone(args) as unknown[]]);
            return result;
          } catch (error) {
            if (!previous) this.replay = undefined;
            throw error;
          } finally {
            this.depth--;
          }
        },
      });
    }
  }
  clear(): void {
    this.replay = undefined;
  }
}
