import { test } from 'node:test';
import { crowdLocal } from './rules-crowd-local.mjs';
for (const seats of [300, 1000]) test(`local real-time Gates: ${seats} players with four Chrome pages, churn and restarts`, { skip: process.env.RULES_EXTENDED !== '1' }, async () => {
  console.log(JSON.stringify(await crowdLocal({ seats, seconds: 60, browsers: 4 })));
});
