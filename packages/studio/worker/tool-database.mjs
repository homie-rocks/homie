export const TOOL_DATABASE_MIGRATION_FILE='0023_tool_data_versions.sql';
export const TOOL_DATABASE_MIGRATION='ALTER TABLE tool_data ADD COLUMN version INTEGER NOT NULL DEFAULT 1;\n';
/** Each mutation is one SQLite statement; callers never hold a JS lock across Workers. */
export function toolDatabase(DB,namespace) {
  const key=k=>{if(typeof k!=='string'||!k.length||k.length>128)throw new Error('Key must contain 1–128 characters');return k;};
  const decode=r=>r?{value:JSON.parse(r.value),version:r.version}:null;
  return Object.freeze({
    async get(k){return (await this.getVersioned(k))?.value??null;},
    async getVersioned(k){return decode(await DB.prepare('SELECT value,version FROM tool_data WHERE namespace=?1 AND key=?2').bind(namespace,key(k)).first());},
    async put(k,value,{version}={}) {
      const text=JSON.stringify(value);if(text===undefined)throw new Error('Value must be JSON');
      if(version!==undefined&&(!Number.isSafeInteger(version)||version<0))throw new Error('Version must be a nonnegative integer (0 creates)');
      const stmt=version===undefined
        ? DB.prepare('INSERT INTO tool_data(namespace,key,value) VALUES(?1,?2,?3) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,version=tool_data.version+1 RETURNING version').bind(namespace,key(k),text)
        : version===0 ? DB.prepare('INSERT OR IGNORE INTO tool_data(namespace,key,value) VALUES(?1,?2,?3) RETURNING version').bind(namespace,key(k),text)
        : DB.prepare('UPDATE tool_data SET value=?3,version=version+1 WHERE namespace=?1 AND key=?2 AND version=?4 RETURNING version').bind(namespace,key(k),text,version);
      const row=await stmt.first();return row?{ok:true,version:row.version}:{ok:false,conflict:true};
    },
    async increment(k,amount=1) {
      if(!Number.isFinite(amount))throw new Error('Increment must be finite');
      const row=await DB.prepare(`INSERT INTO tool_data(namespace,key,value) VALUES(?1,?2,json(?3)) ON CONFLICT(namespace,key) DO UPDATE SET value=json(json_extract(tool_data.value,'$')+?3),version=tool_data.version+1 WHERE json_type(tool_data.value) IN ('integer','real') RETURNING value,version`).bind(namespace,key(k),amount).first();
      if(!row)throw new Error('Increment requires a numeric value');return decode(row);
    },
    async append(k,value) {
      const text=JSON.stringify(value);if(text===undefined)throw new Error('Append requires JSON');
      const row=await DB.prepare(`INSERT INTO tool_data(namespace,key,value) VALUES(?1,?2,json_array(json(?3))) ON CONFLICT(namespace,key) DO UPDATE SET value=json_insert(tool_data.value,'$[#]',json(?3)),version=tool_data.version+1 WHERE json_type(tool_data.value)='array' RETURNING value,version`).bind(namespace,key(k),text).first();
      if(!row)throw new Error('Append requires an array value');return decode(row);
    },
    async list({prefix='',after='',limit=100}={}) {
      if(typeof prefix!=='string'||typeof after!=='string'||!Number.isSafeInteger(limit)||limit<1)throw new Error('List requires a string prefix/cursor and positive page size');
      const rows=(await DB.prepare('SELECT key,value,version FROM tool_data WHERE namespace=?1 AND substr(key,1,?2)=?3 AND key>?4 ORDER BY key LIMIT ?5').bind(namespace,prefix.length,prefix,after,limit+1).all()).results;
      return {items:rows.slice(0,limit).map(r=>({key:r.key,...decode(r)})),next:rows.length>limit?rows[limit-1].key:null};
    },
  });
}
