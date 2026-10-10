import test from "node:test";
import { verifyContinuation } from "./restore-continuation-fixture.mjs";
test("restore sampled command and tick boundaries with 100-tick continuations (z)", () =>
  verifyContinuation("z"));
