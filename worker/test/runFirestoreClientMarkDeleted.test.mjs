import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

// Entry point and esbuild's working directory are both resolved from this
// file's own location, not from process.cwd(). Node's root test discovery runs
// this from the repository root, where a cwd-relative 'test/...' path resolves
// outside the Worker and fails; absWorkingDir additionally keeps esbuild
// resolving against worker/node_modules from either root.
const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(testDirectory, '..');

const result = await build({
  entryPoints: [resolve(testDirectory, 'firestoreClientMarkDeleted.test.mts')],
  absWorkingDir: workerDirectory,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  write: false,
});

const output = result.outputFiles[0];
if (!output) {
  throw new Error('Firestore client regression test did not produce bundled output');
}

await import(`data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`);
