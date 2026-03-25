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
    '--window-size=1440,900',
    '--force-device-scale-factor=2',
    ...(HEADLESS() ? ['--headless'] : []),
    '--no-sandbox',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=TrustedTypesEnforcement',
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

export async function launchBrowser(agentId: string): Promise<{ pid: number; port: number; cdpEndpoint: string }> {
  const port = await redisStore.allocatePort(agentId);
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

export async function claimWarm(agentId: string): Promise<{ pid: number; port: number; cdpEndpoint: string } | null> {
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
    await redis.set(`browser:port:${port}`, agentId);
    return { pid, port, cdpEndpoint: `http://localhost:${port}` };
  }

  // Dead warm browser
  await redisStore.freePort(port);
  return null;
}

const MAX_CONCURRENT_BROWSERS = () => parseInt(process.env.MAX_CONCURRENT_BROWSERS || '3', 10);

async function navigateToBlank(port: number): Promise<void> {
  try {
    const cdpRes = await fetch(`http://localhost:${port}/json/list`, {
      signal: AbortSignal.timeout(3000),
    });
    const targets = await cdpRes.json() as Array<{ url: string; webSocketDebuggerUrl: string }>;
    const pageTarget = targets.find(t => !t.url.startsWith('devtools://'));
    if (!pageTarget || pageTarget.url === 'about:blank') return;

    const ws = await import('ws');
    const cdpWs = new ws.default(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((resolve) => {
      cdpWs.on('open', () => {
        cdpWs.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url: 'about:blank' } }));
      });
      cdpWs.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) { cdpWs.close(); resolve(); }
      });
      cdpWs.on('error', () => { cdpWs.close(); resolve(); });
      setTimeout(() => { cdpWs.close(); resolve(); }, 5000);
    });
  } catch {
    // Non-fatal — browser will still work, just won't be on about:blank
  }
}

async function countAllocatedPorts(): Promise<number> {
  const redis = redisStore.getRedis();
  const portStart = parseInt(process.env.CDP_PORT_START || '19300', 10);
  const portRange = parseInt(process.env.CDP_PORT_RANGE || '100', 10);
  let count = 0;
  for (let offset = 0; offset < portRange; offset++) {
    const exists = await redis.exists(`browser:port:${portStart + offset}`);
    if (exists) count++;
  }
  return count;
}

export async function replenish(count?: number): Promise<void> {
  const target = count ?? parseInt(process.env.WARM_BROWSERS || '1', 10);
  const redis = redisStore.getRedis();

  // Acquire replenish mutex — prevents concurrent replenish calls
  const acquired = await redis.set('session:replenish', '1', 'EX', 10, 'NX');
  if (!acquired) {
    console.log('[BrowserManager] Replenish already in progress, skipping');
    return;
  }

  try {
    const currentWarm = await redis.scard('browser:warm:pids');
    const maxBrowsers = MAX_CONCURRENT_BROWSERS();

    for (let i = currentWarm; i < target; i++) {
      // Capacity check: don't over-provision beyond MAX_CONCURRENT_BROWSERS + 1
      const totalBrowsers = await countAllocatedPorts();
      if (totalBrowsers >= maxBrowsers + 1) {
        console.log(`[BrowserManager] At capacity (${totalBrowsers}/${maxBrowsers + 1}), skipping warm browser`);
        break;
      }

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

        // Navigate to about:blank to guarantee clean state
        await navigateToBlank(port);

        await redis.sadd('browser:warm:pids', `${child.pid}:${port}`);
        console.log(`[BrowserManager] Warm browser ready pid=${child.pid} port=${port}`);
      } catch (err) {
        console.error('[BrowserManager] Failed to warm browser:', err);
      }
    }
  } finally {
    await redis.del('session:replenish');
  }
}

/** @deprecated Use replenish() instead */
export const warmUp = replenish;

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
