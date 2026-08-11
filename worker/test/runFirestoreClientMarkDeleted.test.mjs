import { build } from 'esbuild';

const result = await build({
  entryPoints: ['test/firestoreClientMarkDeleted.test.mts'],
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
