import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const mainCtx = await esbuild.context({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'build/main/index.js',
  external: ['electron', 'playwright'],
  format: 'cjs',
});

const preloadCtx = await esbuild.context({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'build/preload/index.js',
  external: ['electron'],
  format: 'cjs',
});

if (isWatch) {
  await mainCtx.watch();
  await preloadCtx.watch();
  console.log('Watching main + preload...');
} else {
  await mainCtx.rebuild();
  await preloadCtx.rebuild();
  await mainCtx.dispose();
  await preloadCtx.dispose();
  console.log('Main + preload built.');
}