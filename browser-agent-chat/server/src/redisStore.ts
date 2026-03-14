import { Redis } from 'ioredis';
import type { ChatMessage, RedisSession, RedisSessionStatus } from './types.js';

let redis: Redis;

export function getRedis(): Redis {
  return redis;
}

export function connect(url?: string): void {
  redis = new Redis(url || process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
}

// -- Session CRUD --

const DEFAULT_TTL = () => parseInt(process.env.SESSION_TTL_SECONDS || '600', 10);

export async function getSession(projectId: string): Promise<RedisSession | null> {
  const data = await redis.hgetall(`session:${projectId}`);
  if (!data || !data.dbSessionId) return null;
  return {
    dbSessionId: data.dbSessionId,
    status: data.status as RedisSessionStatus,
    cdpPort: parseInt(data.cdpPort, 10),
    cdpEndpoint: data.cdpEndpoint,
    currentUrl: data.currentUrl || '',
    memoryContext: data.memoryContext || '',
    browserPid: parseInt(data.browserPid, 10),
    lastTask: data.lastTask || '',
    createdAt: parseInt(data.createdAt, 10),
    lastActivityAt: parseInt(data.lastActivityAt, 10),
  };
}

export async function setSession(projectId: string, data: Partial<RedisSession>): Promise<void> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) flat[k] = String(v);
  }
  await redis.hset(`session:${projectId}`, flat);
  await refreshTTL(projectId);
}

export async function deleteSession(projectId: string): Promise<void> {
  const session = await getSession(projectId);
  await redis.del(`session:${projectId}`, `screenshot:${projectId}`, `messages:${projectId}`);
  if (session && !isNaN(session.cdpPort)) await freePort(session.cdpPort);
  await redis.zrem('session:expiry', projectId);
}

export async function refreshTTL(projectId: string): Promise<void> {
  const ttl = DEFAULT_TTL();
  const expiryScore = Date.now() + ttl * 1000;
  await redis.pipeline()
    .expire(`session:${projectId}`, ttl)
    .expire(`screenshot:${projectId}`, ttl)
    .expire(`messages:${projectId}`, ttl)
    .zadd('session:expiry', expiryScore, projectId)
    .hset(`session:${projectId}`, 'lastActivityAt', String(Date.now()))
    .exec();
}

export async function listSessions(): Promise<string[]> {
  return redis.zrange('session:expiry', 0, -1);
}

// -- Messages --

export async function pushMessage(projectId: string, msg: ChatMessage): Promise<void> {
  await redis.rpush(`messages:${projectId}`, JSON.stringify(msg));
  await redis.ltrim(`messages:${projectId}`, -200, -1);
}

export async function getMessages(projectId: string): Promise<ChatMessage[]> {
  const raw = await redis.lrange(`messages:${projectId}`, 0, -1);
  return raw.map((r: string) => JSON.parse(r));
}

// -- Screenshot --

export async function setScreenshot(projectId: string, base64: string): Promise<void> {
  await redis.set(`screenshot:${projectId}`, base64);
}

export async function getScreenshot(projectId: string): Promise<string | null> {
  return redis.get(`screenshot:${projectId}`);
}

// -- Port allocation --

const PORT_START = () => parseInt(process.env.CDP_PORT_START || '19300', 10);
const PORT_RANGE = () => parseInt(process.env.CDP_PORT_RANGE || '100', 10);

export async function allocatePort(projectId: string): Promise<number> {
  const start = PORT_START();
  const range = PORT_RANGE();
  for (let offset = 0; offset < range; offset++) {
    const port = start + offset;
    const result = await redis.set(`browser:port:${port}`, projectId, 'NX');
    if (result === 'OK') return port;
  }
  throw new Error('No available CDP ports — max concurrent browsers reached');
}

export async function freePort(port: number): Promise<void> {
  await redis.del(`browser:port:${port}`);
}

// -- Expiry --

let expiryInterval: ReturnType<typeof setInterval> | null = null;

export function pollExpiredSessions(callback: (projectId: string) => Promise<void>): void {
  expiryInterval = setInterval(async () => {
    try {
      const now = Date.now();
      const expired = await redis.zrangebyscore('session:expiry', '-inf', now);
      for (const projectId of expired) {
        await redis.zrem('session:expiry', projectId);
        await callback(projectId).catch(err =>
          console.error(`[EXPIRY] Failed to clean up ${projectId}:`, err)
        );
      }
    } catch (err) {
      console.error('[EXPIRY] Polling error:', err);
    }
  }, 30_000);
}

export function stopPolling(): void {
  if (expiryInterval) {
    clearInterval(expiryInterval);
    expiryInterval = null;
  }
}

export async function shutdown(): Promise<void> {
  stopPolling();
  await redis.quit();
}
