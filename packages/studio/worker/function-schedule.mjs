// Cloudflare's five-field UTC cron dialect: Sunday=1, Saturday=7.
const ranges=[[0,59],[0,23],[1,31],[1,12],[1,7]];
const aliases=[null,null,null,['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],['SUN','MON','TUE','WED','THU','FRI','SAT']];
function field(text,index) {
  const [min,max]=ranges[index],values=new Set(),special=[];
  text=text.toUpperCase();
  if(aliases[index])text=text.replace(/[A-Z]{3}/g,name=>{const n=aliases[index].indexOf(name);if(n<0)throw new Error(`Unknown cron name ${name}`);return String(n+1);});
  for(const part of text.split(',')) {
    if(index===2 && /^(L|LW|(?:[1-9]|[12]\d|3[01])W)$/.test(part) || index===4 && /^[1-7](L|#[1-5])$/.test(part)) {special.push(part);continue;}
    if(!/^(\*|\d+(?:-\d+)?)(?:\/[1-9]\d*)?$/.test(part))throw new Error(`Invalid cron field ${text}`);
    const [base,stepText]=part.split('/'),step=Number(stepText??1);
    const [lo,hi]=base==='*'?[min,max]:base.includes('-')?base.split('-').map(Number):[Number(base),stepText?max:Number(base)];
    if(lo<min||hi>max||lo>hi||!Number.isSafeInteger(step)||step>max-min+1)throw new Error(`Cron field out of range: ${text}`);
    for(let n=lo;n<=hi;n+=step)values.add(n);
  }
  return {values:[...values].sort((a,b)=>a-b),special};
}
const lastDay=d=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
function weekdayNear(d,day) {
  const last=lastDay(d);if(day>last)return null;
  const weekday=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),day)).getUTCDay();
  return weekday===6?(day===1?3:day-1):weekday===0?(day===last?day-2:day+1):day;
}
export function parseSchedule(expression) {
  if(typeof expression!=='string'||expression.trim().split(/\s+/).length!==5)throw new Error('Schedule needs five cron fields');
  const parts=expression.trim().split(/\s+/),fields=parts.map(field);
  const dayMatches=d=>{
    const day=d.getUTCDate(),weekday=d.getUTCDay()+1,last=lastDay(d);
    return fields[3].values.includes(d.getUTCMonth()+1) &&
      (fields[2].values.includes(day)||fields[2].special.some(s=>s==='L'?day===last:s==='LW'?day===weekdayNear(d,last):day===weekdayNear(d,Number(s.slice(0,-1))))) &&
      (fields[4].values.includes(weekday)||fields[4].special.some(s=>weekday===Number(s[0])&&(s.endsWith('L')?day+7>last:Math.ceil(day/7)===Number(s.at(-1)))));
  };
  return {parts,fields,dayMatches,matches(time){const d=new Date(time);return dayMatches(d)&&fields[0].values.includes(d.getUTCMinutes())&&fields[1].values.includes(d.getUTCHours());}};
}
export function nextDue(expression,after=Date.now()) {
  const cron=typeof expression==='string'?parseSchedule(expression):expression;
  const date=new Date(after);date.setUTCHours(0,0,0,0);
  // A Gregorian calendar repeats after 400 years; this also detects impossible dates.
  for(let days=0;days<=146097;days++,date.setUTCDate(date.getUTCDate()+1)) {
    if(!cron.dayMatches(date))continue;
    for(const hour of cron.fields[1].values)for(const minute of cron.fields[0].values) {
      const time=date.getTime()+hour*3600000+minute*60000;
      if(time>after)return time;
    }
  }
  return null;
}
export function scheduleTrigger(definitions,{eventFeeds=false}={}) {
  if(eventFeeds||definitions.some(f=>f.schedule===undefined))return '* * * * *';
  const schedules=definitions.map(f=>parseSchedule(f.schedule));
  if(!schedules.length)return null;
  if(schedules.every(c=>c.parts.join(' ')===schedules[0].parts.join(' ')))return schedules[0].parts.join(' ');
  return ranges.map(([min,max],i)=>{
    if(schedules.every(c=>c.parts[i]===schedules[0].parts[i]))return schedules[0].parts[i];
    if(i===2||i===4)return '*';
    const values=[...new Set(schedules.flatMap(c=>c.fields[i].values))].sort((a,b)=>a-b);
    return values.length===max-min+1?'*':values.join(',');
  }).join(' ');
}
export function scheduleStatus(definitions,crons,now=Date.now()) {
  return definitions.filter(f=>f.schedule!==undefined).map(fn=>{
    try {
      const due=nextDue(fn.schedule,now);
      const runnable=due!==null && crons.some(c=>{try{return parseSchedule(c).matches(due);}catch{return false;}});
      return {function:fn.name,schedule:fn.schedule,nextDue:due===null?null:new Date(due).toISOString(),status:due===null?'Cannot run: schedule has no matching date':runnable?'Configured; awaiting scheduled delivery':'Cannot run: no configured trigger covers the next due time'};
    } catch(error) {return {function:fn.name,schedule:fn.schedule,nextDue:null,status:`Cannot run: ${error.message}`};}
  });
}
