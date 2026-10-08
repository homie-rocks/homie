// The engine package contract (scripts/test/engine-package.mjs): name, licence, exports, every module
// built and loading in Node, and every import declared and pinned.
import { testEnginePackage } from './contract.mjs';

testEnginePackage(new URL('..', import.meta.url), {
  publicModules: ['Bake', 'Crowd', 'Grid', 'Mesh', 'Query', 'Random', 'State', 'Three'],
});
