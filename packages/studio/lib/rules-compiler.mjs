/**
 * The type compiler in a thread of its own, so a compiler that fails or never ends does not take the build with it.
 *
 * Like the play (rules-check.mjs), it is ended from outside by counted beats only, thousands of times past what a
 * game's types take, and that end is said to be the compiler's fault, never a type error in the game. No clock is
 * read, and nothing here decides anything about the rules.
 */
import { Worker } from 'node:worker_threads';
export function runRulesCompiler(compiler, args, { superviseSeconds = 3600 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = ''; let done = false; let beats = 0;
    const worker = new Worker(`
      const {parentPort,workerData} = require('node:worker_threads');
      process.argv = [process.execPath,workerData.compiler,...workerData.args];
      process.stdout.write = (text) => {parentPort.postMessage({stdout:String(text)});return true;};
      process.stderr.write = (text) => {parentPort.postMessage({stderr:String(text)});return true;};
      require(workerData.compiler);
    `, { eval: true, workerData: { compiler, args }, resourceLimits: { maxOldGenerationSizeMb: 1536 } });
    const finish = async (error, status) => {
      if (done) return;
      done = true; clearInterval(supervisor); await worker.terminate();
      if (error) reject(error); else resolve({ stdout, stderr, status });
    };
    const supervisor = setInterval(() => { if ((beats += 1) > superviseSeconds) finish(new Error(`The rules compiler was still running after ${superviseSeconds} seconds and was ended from outside. This is a fault in the compiler, not a type error in the rules: report the game with this message.`)); }, 1000);
    supervisor.unref();
    worker.on('message', (message) => { stdout += message.stdout ?? ''; stderr += message.stderr ?? ''; if (stdout.length + stderr.length > 8 * 1024 * 1024) finish(new Error('The rules compiler produced more than 8 MB of diagnostics.')); });
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => finish(null, code));
  });
}
