import {createHash,timingSafeEqual} from 'node:crypto';
export function authorized(header,key){
 if(!key||typeof header!=='string')return false;
 const hash=value=>createHash('sha256').update(value).digest();
 return timingSafeEqual(hash(header),hash('Bearer '+key));
}
