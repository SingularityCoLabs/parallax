import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const distDirectory = resolve(projectRoot, 'dist');

if (dirname(distDirectory) !== projectRoot) {
  throw new Error(`Refusing to clean unexpected output directory: ${distDirectory}`);
}

rmSync(distDirectory, { recursive: true, force: true });
