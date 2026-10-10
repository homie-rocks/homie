// The engine package contract (scripts/test/engine-package.mjs): name, licence, exports, every module
// built and loading in Node, and every import declared and pinned.
import { testEnginePackage } from "../../../scripts/test/engine-package.mjs";

testEnginePackage(new URL("..", import.meta.url), {
  privateUntilPublished: true,
  extraExports: {
    "./internal/*": null,
    "./Shapes.js": null,
    "./vendor/*": null,
    "./vendor/rapier.wasm": { types: "./dist/vendor/rapier.wasm.d.ts", default: "./dist/vendor/rapier.wasm" },
  },
  typeOnlyDevDependencies: ["@dimforge/rapier3d-deterministic"],
  noticeAppendix:
    "\nThis product includes Rapier 3D by Dimforge, licensed under the Apache\nLicense, Version 2.0. Its deterministic WebAssembly engine is redistributed\nwith this package. https://rapier.rs/\n",
});
