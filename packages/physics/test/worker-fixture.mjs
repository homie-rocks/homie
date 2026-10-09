import wasm from "@homie-rocks/physics/vendor/rapier.wasm";
import { initPhysics } from "@homie-rocks/physics/Worker.js";
import { run } from "./runtime-fixture.mjs";
let missingModule;
try {
  await initPhysics();
} catch (error) {
  missingModule = error;
}
if (!missingModule?.message.includes("Workers must import"))
  throw new Error("Missing compiled module must explain the Worker import");
await initPhysics(wasm);
export default {
  fetch() {
    return Response.json(run());
  },
};
