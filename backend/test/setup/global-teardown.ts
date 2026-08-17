import * as fs from 'fs';
import { ENV_FILE } from './env-file';

export default async function globalTeardown() {
  const container = (globalThis as any).__TC_CONTAINER__;
  if (container) await container.stop();
  fs.rmSync(ENV_FILE, { force: true });
}
