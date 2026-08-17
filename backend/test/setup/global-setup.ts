import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { ENV_FILE } from './env-file';

function waitForPort(
  host: string,
  port: number,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const sock = new net.Socket();
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Port ${host}:${port} not reachable after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });
      sock.connect(port, host);
    }
    tryConnect();
  });
}

export default async function globalSetup() {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('mikrolan_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  await waitForPort(host, port);

  // Use 127.0.0.1 instead of localhost — Prisma query engine may resolve
  // localhost to IPv6 (::1) while Docker only maps to IPv4
  const resolvedHost = host === 'localhost' ? '127.0.0.1' : host;
  const databaseUrl =
    `postgresql://test:test@${resolvedHost}:${port}/mikrolan_test?connect_timeout=10`;

  // Retry prisma migrate deploy — Docker Desktop port forwarding can lag
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      execSync('npx prisma migrate deploy', {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      });
      break;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  process.env.__TC_DATABASE_URL__ = databaseUrl;
  (globalThis as any).__TC_CONTAINER__ = container;

  // globalSetup runs in a process separate from each test file's own
  // environment, so process.env mutations above are invisible to the tests
  // themselves — write the URL to disk and re-read it from `setupFiles`
  // (which does run inside each test file's environment) instead.
  fs.writeFileSync(ENV_FILE, JSON.stringify({ DATABASE_URL: databaseUrl }));
}
