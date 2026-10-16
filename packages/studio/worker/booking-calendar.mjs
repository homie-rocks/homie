const dayMs=86400000;
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value??''))throw new Error('Use a calendar date YYYY-MM-DD');const stamp=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==value)throw new Error('Invalid calendar date');return stamp;};
/** Resolve wall time, refusing DST gaps and ambiguous times instead of silently moving a booking. */
function instant(day,time,format) {
 const wanted=day+'T'+time,base=Date.parse(wanted+':00Z');
 const parts=stamp=>Object.fromEntries(format.formatToParts(stamp).map(p=>[p.type,p.value]));
 const local=stamp=>{const p=parts(stamp);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;};
 const offsets=new Set([-dayMs,0,dayMs].map(delta=>{const p=parts(base+delta);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-(base+delta);}));
 const matches=[...offsets].map(offset=>base-offset).filter(stamp=>local(stamp)===wanted);
 if(matches.length!==1)throw new Error(`${wanted} does not exist or is ambiguous in this time zone; choose another time or publish an explicit offset timestamp`);
 return matches[0];
}
/** Inclusive season dates; each returned slot may span several local calendar days. */
export function calendarSlots({startDate,endDate,timeZone,time='09:00',days,durationMinutes=60,capacity=1,weekdays,resources,options,prefix='slot',exceptions={}}) {
 const start=date(startDate),end=date(endDate);
 if(!exceptions||Array.isArray(exceptions)||typeof exceptions!=='object')throw new Error('Invalid calendar exceptions');
 for(const [day,change] of Object.entries(exceptions)){
  const at=date(day);
  if(at<start||at>end||weekdays&&!weekdays.includes(new Date(at).getUTCDay()))throw new Error('Exception is outside the series');
  if(change!==null&&(!change||typeof change!=='object'||Array.isArray(change)||Object.keys(change).some(k=>!['time','capacity','durationMinutes'].includes(k)||change[k]===undefined)))throw new Error('Invalid calendar exception');
 }
 if(end<start||end-start>3660*dayMs||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isSafeInteger(capacity)||capacity<1||days!==undefined&&(!Number.isSafeInteger(days)||days<1)||!Number.isSafeInteger(durationMinutes)||durationMinutes<1)throw new Error('Invalid calendar range, time, duration or capacity');
 if(weekdays&&(!Array.isArray(weekdays)||weekdays.some(n=>!Number.isInteger(n)||n<0||n>6)))throw new Error('weekdays uses 0 (Sunday) through 6 (Saturday)');
 if(typeof timeZone!=='string'||!timeZone)throw new Error('Declare the place timeZone');
 const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),slots=[];
 for(let at=start;at<=end;at+=dayMs) {
  if(weekdays&&!weekdays.includes(new Date(at).getUTCDay()))continue;
  const day=new Date(at).toISOString().slice(0,10);
  if(Object.hasOwn(exceptions,day)){
   const change=exceptions[day];if(change===null)continue;
   const [slot]=calendarSlots({startDate:day,endDate:day,timeZone,time,days:Object.hasOwn(change,'durationMinutes')?undefined:days,durationMinutes,capacity,resources,options,prefix,...change});
   // Identity follows the series occurrence, even when its wall time changes.
   slots.push({...slot,id:`${prefix}-${day}-${time.replace(':','')}`});continue;
  }
  const from=instant(day,time,format),to=days?instant(new Date(at+days*dayMs).toISOString().slice(0,10),time,format):from+durationMinutes*60000;
  slots.push({id:`${prefix}-${day}-${time.replace(':','')}`,date:day,timeZone,start:new Date(from).toISOString(),end:new Date(to).toISOString(),capacity,...(resources?{resources}:{}),...(options?{options}:{})});
 }
 return slots;
}
