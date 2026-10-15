export const BOOKING_RESOURCES_MIGRATION_FILE='0030_booking_resources.sql';
const capacityCheck=`
 SELECT RAISE(ABORT,'resource capacity unavailable') WHERE EXISTS (
 WITH wanted AS (SELECT json_extract(value,'$.resource') resource,json_extract(value,'$.collection') collection,json_extract(value,'$.start') start,json_extract(value,'$.end') end,json_extract(value,'$.units') units FROM json_each(NEW.allocation)),
 existing AS (SELECT json_extract(a.value,'$.resource') resource,json_extract(a.value,'$.collection') collection,json_extract(a.value,'$.start') start,json_extract(a.value,'$.end') end,json_extract(a.value,'$.units') units FROM shop_bookings b,json_each(b.allocation) a WHERE b.app=NEW.app AND b.id!=NEW.id AND b.state IN ('held','confirmed')),
 points AS (SELECT resource,collection,start point FROM wanted UNION SELECT resource,collection,start FROM existing)
 SELECT 1 FROM points p WHERE EXISTS(SELECT 1 FROM wanted w WHERE w.resource=p.resource AND w.collection=p.collection AND w.start<=p.point AND w.end>p.point)
 AND (COALESCE((SELECT SUM(units) FROM wanted w WHERE w.resource=p.resource AND w.collection=p.collection AND w.start<=p.point AND w.end>p.point),0)+COALESCE((SELECT SUM(units) FROM existing e WHERE e.resource=p.resource AND e.collection=p.collection AND e.start<=p.point AND e.end>p.point),0))>
 COALESCE((SELECT json_extract(value,'$.capacity') FROM app_records WHERE app=NEW.app AND collection=p.collection AND id=p.resource),0));`;
export const BOOKING_RESOURCES_MIGRATION=`ALTER TABLE shop_bookings ADD COLUMN allocation TEXT NOT NULL DEFAULT '[]';
ALTER TABLE shop_bookings ADD COLUMN choices TEXT NOT NULL DEFAULT '{}';
${['INSERT','UPDATE OF state,allocation'].map((op,i)=>`CREATE TRIGGER booking_resource_${i} BEFORE ${op} ON shop_bookings WHEN NEW.state IN ('held','confirmed') BEGIN ${capacityCheck} END;`).join('\n')}
CREATE TRIGGER booking_resource_move BEFORE UPDATE OF slot ON shop_bookings WHEN OLD.slot!=NEW.slot AND OLD.allocation!='[]' AND OLD.state IN ('held','confirmed') BEGIN SELECT RAISE(ABORT,'resource booking move requires release and a new allocation'); END;
CREATE TRIGGER booking_resource_edit BEFORE UPDATE OF value ON app_records WHEN EXISTS(SELECT 1 FROM shop_bookings b,json_each(b.allocation) a WHERE b.app=OLD.app AND b.state IN ('held','confirmed') AND json_extract(a.value,'$.resource')=OLD.id AND json_extract(a.value,'$.collection')=OLD.collection) AND NEW.value!=OLD.value BEGIN SELECT RAISE(ABORT,'resource has active bookings; release or finish them before editing'); END;
CREATE TRIGGER booking_resource_delete BEFORE DELETE ON app_records WHEN EXISTS(SELECT 1 FROM shop_bookings b,json_each(b.allocation) a WHERE b.app=OLD.app AND b.state IN ('held','confirmed') AND json_extract(a.value,'$.resource')=OLD.id AND json_extract(a.value,'$.collection')=OLD.collection) BEGIN SELECT RAISE(ABORT,'resource has active bookings'); END;
`;
export async function allocateResources(env,app,spec,slot,args) {
 const row=await env.DB.prepare('SELECT value FROM app_records WHERE app=?1 AND collection=?2 AND id=?3').bind(app,spec.slots,slot).first();
 if(!row)throw new Error('Slot unavailable');
 const data=JSON.parse(row.value),option=args.option===undefined?null:data.options?.find(o=>o.id===args.option);
 if(args.option!==undefined&&!option)throw new Error('Choose a declared option');
 if(data.requireOption&&!option)throw new Error('Choose an option');
 const parts=option?.components??(data.resources?[{resources:data.resources,skills:data.skills,attributes:data.attributes}]:[]);
 const components=[...parts];
 for(const [id,count] of Object.entries(args.addons??{})) {
  const addon=data.addons?.find(a=>a.id===id);if(!addon)throw new Error('Unknown add-on');
  for(const component of addon.components??[])components.push({...component,units:(component.units??1)*count});
 }
 if(!components.length){if(args.resource)throw new Error('This slot has no declared resources');return [];}
 if(!spec.resources)throw new Error('Declare booking.resources collection');
 const start=Date.parse(data.start),end=Date.parse(data.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Resource slot needs start and end timestamps');
 if(components.length>32)throw new Error('A package supports at most 32 resource components');
 const active=(await env.DB.prepare("SELECT allocation FROM shop_bookings WHERE app=?1 AND state IN ('held','confirmed')").bind(app).all()).results.flatMap(r=>JSON.parse(r.allocation));
 const allocations=[];
 for(const [index,c] of components.entries()) {
  if(!Array.isArray(c.resources)||!c.resources.length||c.resources.length>64)throw new Error('Declare candidate resources');
  const candidates=index===0&&args.resource?[args.resource]:c.resources;
  if(candidates.some(id=>!c.resources.includes(id)))throw new Error('Preferred resource is unavailable for this option');
  const from=start+(c.offsetMinutes??0)*60000,to=c.durationMinutes?from+c.durationMinutes*60000:end,units=(c.units??1)*(args.quantity??1);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<start||to>end||to<=from||!Number.isSafeInteger(units)||units<1)throw new Error('Invalid package resource interval or units');
  let selected,qualified=false;
  for(const resource of candidates) {
   const record=await env.DB.prepare('SELECT value FROM app_records WHERE app=?1 AND collection=?2 AND id=?3').bind(app,spec.resources,resource).first();
   if(!record)continue;const r=JSON.parse(record.value);
   if(!Number.isSafeInteger(r.capacity)||r.capacity<1||(c.skills??[]).some(skill=>!r.skills?.includes(skill))||Object.entries(c.attributes??{}).some(([k,v])=>r.attributes?.[k]!==v))continue;
   qualified=true;const overlapping=[...active,...allocations].filter(a=>a.resource===resource&&a.collection===spec.resources&&a.start<to&&a.end>from);
   if([from,...overlapping.map(a=>a.start).filter(t=>t>=from)].some(at=>units+overlapping.filter(a=>a.start<=at&&a.end>at).reduce((n,a)=>n+a.units,0)>r.capacity))continue;
   selected={resource,collection:spec.resources,start:from,end:to,units};break;
  }
  if(!selected)throw new Error(qualified?'Resource capacity unavailable for these dates':'No resource matches the required skills or attributes');
  allocations.push(selected);
 }
 return allocations;
}
