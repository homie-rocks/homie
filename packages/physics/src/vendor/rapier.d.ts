import type * as Rapier from "@dimforge/rapier3d-deterministic";
export declare function createEngine(): typeof Rapier & {
  initialize(module: WebAssembly.Module): void;
  memory: WebAssembly.Memory;
};
