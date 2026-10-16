import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarSlots} from '../worker/booking-calendar.mjs';
const series={startDate:'2026-10-23',endDate:'2026-11-13',timeZone:'America/Los_Angeles',time:'19:00',weekdays:[5],capacity:12,prefix:'supper'};
test('weekly occurrences cross DST, skip holidays and preserve exception identity',()=>{
 const base=calendarSlots(series);
 const slots=calendarSlots({...series,exceptions:{'2026-10-30':null,'2026-11-06':{time:'18:00',capacity:8,durationMinutes:90}}});
 assert.equal(slots.length,3);assert.equal(slots[0].start,'2026-10-24T02:00:00.000Z');
 assert.equal(slots[1].start,'2026-11-07T02:00:00.000Z');assert.equal(slots[1].end,'2026-11-07T03:30:00.000Z');
 assert.equal(slots[1].capacity,8);assert.equal(slots[1].id,base[2].id);
});
test('bad dates, unrecognized fields, off-series dates and DST ambiguity refuse',()=>{
 for(const exceptions of [{'2026-10-24':null},{'2026-02-30':null},{'2026-10-23':{price:1}},{'2026-10-23':{capacity:0}},[]])assert.throws(()=>calendarSlots({...series,exceptions}));
 assert.throws(()=>calendarSlots({...series,startDate:'2026-11-01',endDate:'2026-11-01',weekdays:[0],exceptions:{'2026-11-01':{time:'01:30'}}}),/ambiguous/);
});
