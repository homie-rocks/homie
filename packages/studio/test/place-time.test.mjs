import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeTime} from '../links/time.mjs';
test('place time follows IANA summer/winter rules and rejects nonexistent local times',()=>{
 assert.equal(new Date(placeTime('2026-01-15','09:30','America/New_York')).toISOString(),'2026-01-15T14:30:00.000Z');
 assert.equal(new Date(placeTime('2026-07-15','09:30','America/New_York')).toISOString(),'2026-07-15T13:30:00.000Z');
 assert.throws(()=>placeTime('2026-03-08','02:30','America/New_York'),/does not exist/);
 assert.throws(()=>placeTime('2026-02-30','09:30','America/New_York'),/date/);
 assert.throws(()=>placeTime('2026-01-15','09:30','-07:00'),/IANA/);
});
test('repeated autumn hours require an explicit earlier/later choice',()=>{
 assert.throws(()=>placeTime('2026-11-01','01:30','America/New_York'),/ambiguous/);
 assert.equal(placeTime('2026-11-01','01:30','America/New_York',{disambiguation:'later'})-placeTime('2026-11-01','01:30','America/New_York',{disambiguation:'earlier'}),3600000);
});
