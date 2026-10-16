import {directoryUrl} from './directory-choice.mjs';
export function directoryOf(cat) {
  return directoryUrl(cat?.studio?.directory);
}

export let studioTools = async () => [];

export function useTools(load) { studioTools = load; }

export function getStudioTools() { return studioTools(); }
