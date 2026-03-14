import Redis from 'ioredis';
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
  throw new Error('Not implemented');
}

export async function getMessages(projectId: string): Promise<ChatMessage[]> {
  throw new Error('Not implemented');
}

// -- Screenshot --

export async function setScreenshot(projectId: string, base64: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function getScreenshot(projectId: string): Promise<string | null> {
  throw new Error('Not implemented');
}

// -- Port allocation --

export async function allocatePort(projectId: string): Promise<number> {
  throw new Error('Not implemented');
}

export async function freePort(port: number): Promise<void> {
  await redis.del(`browser:port:${port}`);
}

// -- Expiry --

export function pollExpiredSessions(callback: (projectId: string) => Promise<void>): void {
  throw new Error('Not implemented');
}

export function stopPolling(): void {
  throw new Error('Not implemented');
}

export async function shutdown(): Promise<void> {
  throw new Error('Not implemented');
}
