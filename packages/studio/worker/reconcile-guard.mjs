/** Private per-delivery fence, never a deploy binding. */
export const RECONCILE_GUARD=Symbol('reconcileGuard');

/** Statements may be prepared before an await, so check at execution, including batches. */
export function guardedDatabase(db,check) {
  const originals=new WeakMap();
  const statement=raw=>{
    const wrapped=new Proxy(raw,{get(target,key){
      if(key==='bind')return (...args)=>statement(target.bind(...args));
      if(['run','first','all','raw'].includes(key))return async(...args)=>{await check();return target[key](...args);};
      return Reflect.get(target,key);
    }});
    originals.set(wrapped,raw);return wrapped;
  };
  return new Proxy(db,{get(target,key){
    if(key==='prepare')return query=>statement(target.prepare(query));
    if(key==='batch')return async statements=>{await check();return target.batch(statements.map(s=>originals.get(s)??s));};
    if(key==='exec')return async(...args)=>{await check();return target.exec(...args);};
    if(key==='withSession')return (...args)=>guardedDatabase(target.withSession(...args),check);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}
