// Studio declarations register synchronously; their implementation loads on demand.
let load=async()=>[];
export function useFunctions(loader) {load=loader;}
export const loadFunctions=()=>load();
