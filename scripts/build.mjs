import { mkdir, cp } from 'node:fs/promises';

// Copy an explicit allowlist; never publish tests, local state, or development tools.
const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg', 'src', 'README.md', 'THIRD_PARTY_NOTICES.md', '.nojekyll']) {
  await cp(new URL(file, root), new URL(file, output), { recursive: true });
}
console.log('Static site prepared in dist/.');
