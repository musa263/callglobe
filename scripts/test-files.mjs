import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Discover colocated tests without shell-specific recursive glob expansion.
function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'dist', '.git'].includes(entry.name) ? [] : discover(file);
    return entry.isFile() && /\.test\.(ts|js)$/.test(entry.name) ? [file] : [];
  });
}

const roots = process.argv.slice(2);
if (!roots.length) throw new Error('Supply one or more test directories.');
const files = [...new Set(roots.flatMap(discover))].sort();
if (!files.length) throw new Error('No unit tests were discovered.');
console.log(`Running ${files.length} unit-test files.`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
