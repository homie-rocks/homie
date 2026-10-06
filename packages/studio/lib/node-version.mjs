/**
 * THE NODE.JS THIS TOOLKIT NEEDS, SAID BEFORE ANYTHING ELSE RUNS.
 *
 * `@homie-rocks/studio` needs Node.js 22 or newer (package.json `engines`), and npm only warns about that. On an
 * older Node the commands did not say so: `homie-studio dev` under Node 20 ended with no word at all, and the person
 * was left to guess. So the CLI imports this file FIRST. An ES module's imports are evaluated in order, so this
 * runs before any other file of the toolkit does, and on a Node that is too old the command ends here, with the
 * version it found, the version it needs and how to get it.
 *
 * This file is read by the old Node it complains about, so it stays plain: no syntax or built-in newer than Node 14.
 * (A file the old Node cannot even parse fails before any code runs; nothing in this package's own code is known to
 * do that on Node 18 or 20, and if one ever does, Node prints its own syntax error, which is not silent either.)
 */
export const NODE_MIN = 22;

/** What is wrong with this Node.js version for the toolkit, as one sentence, or null when it is new enough. */
export function nodeProblem(version) {
  var found = String(version === undefined ? process.versions.node : version);
  var major = Number(found.split('.')[0]);
  if (major >= NODE_MIN) return null;
  return 'homie-studio needs Node.js ' + NODE_MIN + ' or newer, and this is Node.js ' + (found || 'of an unknown version') + '. '
    + 'Install Node.js ' + NODE_MIN + ' (https://nodejs.org, or `nvm install ' + NODE_MIN + '` / `fnm install ' + NODE_MIN + '`), '
    + 'make it the one this terminal runs (`node --version` says which), then run the command again. Nothing was started or changed.';
}

/**
 * End the command now when this Node.js is too old. `--json` gets the same refusal as JSON on stdout, like every
 * other refusal of the CLI; a person gets one line on stderr. Exit status 1 either way.
 */
export function requireNode(version, argv) {
  var why = nodeProblem(version);
  if (!why) return;
  var args = argv === undefined ? process.argv.slice(2) : argv;
  if (args.indexOf('--json') >= 0) process.stdout.write(JSON.stringify({ ok: false, needs: 'node', why: why }, null, 2) + '\n');
  else process.stderr.write('homie-studio: ' + why + '\n');
  process.exit(1);
}

// HOMIE_STUDIO_NODE: the toolkit's own tests say which version to judge (no machine here has an old Node to run).
requireNode(process.env.HOMIE_STUDIO_NODE || undefined);
