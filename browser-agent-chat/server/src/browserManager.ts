import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import * as redisStore from './redisStore.js';

const HEADLESS = () => process.env.HEADLESS !== 'false';

function getChromiumPath(): string {
  return chromium.executablePath();
}

function buildArgs(port: number): string[] {
  return [
    `--remote-debugging-port=${port}`,
    ...(HEADLESS() ? ['--headless'] : []),
    '--no-sandbox',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
  ];
}

export async function waitForCDP(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`CDP not ready on port ${port} after ${timeoutMs}ms`);
}

export async function launchBrowser(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string }> {
  const port = await redisStore.allocatePort(projectId);
  const chromePath = getChromiumPath();

  const child = spawn(chromePath, buildArgs(port), {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (!child.pid) {
    await redisStore.freePort(port);
    throw new Error('Failed to spawn Chromium process — no PID returned');
  }

  const pid = child.pid;
  const cdpEndpoint = `http://localhost:${port}`;

  await waitForCDP(port, 10_000);

  return { pid, port, cdpEndpoint };
}

export async function killBrowser(pid: number, port: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already dead
    await redisStore.freePort(port);
    return;
  }

  // Wait up to 3s for graceful exit, then SIGKILL
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      // Process exited
      await redisStore.freePort(port);
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Force kill
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
  await redisStore.freePort(port);
}

export async function isAlive(pid: number, port: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function claimWarm(projectId: string): Promise<{ pid: number; port: number; cdpEndpoint: string } | null> {
  const redis = redisStore.getRedis();
  const member = await redis.spop('browser:warm:pids');
  if (!member) return null;

  const [pidStr, portStr] = (member as string).split(':');
  const pid = parseInt(pidStr, 10);
  const port = parseInt(portStr, 10);

  if (await isAlive(pid, port)) {
    // Reassign port from warm to this project.
    // Uses bare SET (not NX) to overwrite the __warm_* allocation from warmUp().
    // This is intentionally different from allocatePort() which uses SET NX.
    await redis.set(`browser:port:${port}`, projectId);
    return { pid, port, cdpEndpoint: `http://localhost:${port}` };
  }

  // Dead warm browser
  await redisStore.freePort(port);
  return null;
}

export async function warmUp(count?: number): Promise<void> {
  const target = count ?? parseInt(process.env.WARM_BROWSERS || '1', 10);
  const redis = redisStore.getRedis();
  const currentWarm = await redis.scard('browser:warm:pids');

  for (let i = currentWarm; i < target; i++) {
    try {
      const warmId = `__warm_${Date.now()}_${i}`;
      const port = await redisStore.allocatePort(warmId);
      const chromePath = getChromiumPath();

      const child = spawn(chromePath, buildArgs(port), {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      if (!child.pid) {
        await redisStore.freePort(port);
        throw new Error('Failed to spawn warm Chromium — no PID');
      }

      await waitForCDP(port, 10_000);
      await redis.sadd('browser:warm:pids', `${child.pid}:${port}`);
      console.log(`[BrowserManager] Warm browser ready pid=${child.pid} port=${port}`);
    } catch (err) {
      console.error('[BrowserManager] Failed to warm browser:', err);
    }
  }
}

export async function cleanupOrphanedWarm(): Promise<void> {
  const redis = redisStore.getRedis();
  const members = await redis.smembers('browser:warm:pids');

  for (const member of members) {
    const [pidStr, portStr] = member.split(':');
    const pid = parseInt(pidStr, 10);
    const port = parseInt(portStr, 10);

    if (!await isAlive(pid, port)) {
      await redis.srem('browser:warm:pids', member);
      await redisStore.freePort(port);
      try { process.kill(pid, 'SIGKILL'); } catch {}
      console.log(`[BrowserManager] Cleaned orphaned warm browser pid=${pid} port=${port}`);
    }
  }
}
