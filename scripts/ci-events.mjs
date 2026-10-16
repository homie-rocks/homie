import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const eventTests=[
  'mcp-events', 'mcp-events-workerd', 'event-resources-workerd',
  'event-delivery-workerd', 'event-webhooks', 'event-webhooks-workerd',
  'studios-events', 'sse-fixture',
].map(name=>`packages/studio/test/${name}.test.mjs`);

// Include shared auth, routing, record writes, deployment and fixtures: these
// tests exercise their imports transitively, not just files named "events".
export function eventsAffected(paths) {
  return !paths || paths.some(path=>
    /^(packages\/studio\/(worker|lib|test)\/|template\/|\.github\/)/.test(path) ||
    /^(package(-lock)?\.json|packages\/[^/]+\/package\.json|scripts\/ci-[^/]+)$/.test(path));
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.includes('--needed'))console.log(eventsAffected(process.env.CI_CHANGED_PATHS?JSON.parse(process.env.CI_CHANGED_PATHS):null));
  else {
    const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...eventTests],{stdio:'inherit'});
    process.exitCode=result.status??1;
  }
}
