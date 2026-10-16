import {mountTerrainMap} from '../src/index.mjs';
const data=await (await fetch(new URL('./route.json',import.meta.url))).json();
data.heightmap=new URL('./heightmap.png',import.meta.url).href;
try { window.map=await mountTerrainMap(document.querySelector('main'),data); } catch(error) { document.querySelector('main').textContent=`Map could not load: ${error.message}`; throw error; }
