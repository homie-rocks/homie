/** Interpret a place's calendar date and wall time using the runtime's IANA zone data. */
export function placeTime(date,time,timeZone,{disambiguation='reject'}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Use a calendar date YYYY-MM-DD and time HH:MM');
 if(typeof timeZone!=='string'||/^[+-]/.test(timeZone))throw new Error('Use an IANA time zone');
 if(!['reject','earlier','later'].includes(disambiguation))throw new Error('Unknown time disambiguation');
 const naive=Date.parse(date+'T'+time+':00Z');
 if(!Number.isFinite(naive)||new Date(naive).toISOString().slice(0,10)!==date)throw new Error('Invalid calendar date');
 let format;try{format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}catch{throw new Error('Use a valid IANA time zone');}
 const wall=epoch=>{
  const p=Object.fromEntries(format.formatToParts(epoch).map(p=>[p.type,p.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
 };
 const offsets=new Set();
 // Sample both sides of even a whole-day civil transition; do not assume an hour-sized DST shift.
 for(let h=-48;h<=48;h+=6){const sample=naive+h*3600000;offsets.add(wall(sample)-sample);}
 const choices=[...offsets].map(offset=>naive-offset).filter(epoch=>wall(epoch)===naive).sort((a,b)=>a-b);
 if(!choices.length)throw new Error('This local time does not exist in the place’s time zone');
 if(choices.length>1&&disambiguation==='reject')throw new Error('This local time is ambiguous; choose earlier or later explicitly');
 return disambiguation==='later'?choices.at(-1):choices[0];
}
