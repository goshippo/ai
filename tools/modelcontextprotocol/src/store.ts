import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export class FileStore {
  private dir: string;

  constructor(baseDir: string, host: string) {
    const slug = createHash('sha256').update(host).digest('hex').slice(0, 16);
    this.dir = join(baseDir, slug);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  read<T>(key: string): T | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dir, `${key}.json`), 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  write(key: string, value: unknown): void {
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value), { mode: 0o600 });
  }

  delete(key: string): void {
    try {
      unlinkSync(join(this.dir, `${key}.json`));
    } catch (e) {
      // A missing key is already in the desired state; only real errors bubble.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
