import * as implementation from './Generated.ts';
import type * as api from 'navcat/blocks';
export const crowd: typeof api.crowd = implementation.crowd as unknown as typeof api.crowd;
export const pathCorridor: typeof api.pathCorridor =
  implementation.pathCorridor as unknown as typeof api.pathCorridor;
export const localBoundary: typeof api.localBoundary =
  implementation.localBoundary as unknown as typeof api.localBoundary;
export const obstacleAvoidance: typeof api.obstacleAvoidance =
  implementation.obstacleAvoidance as unknown as typeof api.obstacleAvoidance;
