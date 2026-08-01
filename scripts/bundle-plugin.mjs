// Bundles the built CLI (with core and viewer) into a single dependency-free
// executable inside the plugin, so `claude plugin install appshape` is the
// entire install on any machine with Node.
//
// Run after `pnpm build`:  node scripts/bundle-plugin.mjs
import { build } from 'esbuild';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'plugin', 'bin', 'shape.mjs');

await build({
  entryPoints: [join(root, 'packages', 'cli', 'dist', 'main.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'error',
});
chmodSync(outfile, 0o755);

const shim = `#!/usr/bin/env bash
# appshape CLI, bundled and dependency-free. Requires only node on PATH.
exec node "$(dirname "\${BASH_SOURCE[0]}")/shape.mjs" "$@"
`;
writeFileSync(join(root, 'plugin', 'bin', 'shape'), shim);
chmodSync(join(root, 'plugin', 'bin', 'shape'), 0o755);
console.log(`bundled ${outfile}`);
