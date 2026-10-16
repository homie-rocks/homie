/** Declarations stay cheap to inspect on HTTP routes; the host engine loads in Table. */
export const games=new Map();
export const compiled=new Map();
export function hostRules(table) {
  games.clear();compiled.clear();
  if(!table||typeof table!=='object')return 0;
  for(const [id,entry] of Object.entries(table))if(entry&&typeof entry==='object'&&entry.rules)games.set(id,entry);
  return games.size;
}
export const hostedGame=id=>games.has(id);
export const hostedBuild=id=>games.get(id);
