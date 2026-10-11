#!/usr/bin/env node
/** What a lasting world writes, before and after the journal: rows and bytes a player-hour, priced. `--world` for one 1,000-player room. */
import { measureWorldWrites } from '../packages/studio/test/world-writes.mjs';
console.log(JSON.stringify(measureWorldWrites({ world: process.argv.includes('--world') }), null, 2));
