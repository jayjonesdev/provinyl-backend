/* ProVinyl — app version, read from package.json at startup. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
