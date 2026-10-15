/** Extracted from the studio runtime; behavior is unchanged. */
import {directoryUrl} from './directory-choice.mjs';

function directoryOf(cat) {
  return directoryUrl(cat?.studio?.directory);
}

let studioTools = async () => [];

function useTools(load) { studioTools = load; }

function getStudioTools() { return studioTools(); }

export {directoryOf,studioTools,useTools,getStudioTools};

