import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock redis instance
const mockRedis = {
  hset: vi.fn().mockResolvedValue('OK'),
  hgetall: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zadd: vi.fn().mockResolvedValue(1),
  zrem: vi.fn().mockResolvedValue(1),
  zrange: vi.fn().mockResolvedValue([]),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  rpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  lrange: vi.fn().mockResolvedValue([]),
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  pipeline: vi.fn().mockReturnValue({
    expire: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  }),
  quit: vi.fn().mockResolvedValue('OK'),
};

vi.mock('ioredis', () => {
  return {
    default: function MockRedis() {
      return mockRedis;
    },
  };
});

import {
  connect,
  getSession,
  setSession,
  deleteSession,
  listSessions,
} from '../src/redisStore.js';

describe('redisStore — session CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('getSession returns null when no data', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});
    const result = await getSession('proj-1');
    expect(result).toBeNull();
    expect(mockRedis.hgetall).toHaveBeenCalledWith('session:proj-1');
  });

  it('getSession returns parsed RedisSession when data exists', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      dbSessionId: 'db-123',
      status: 'idle',
      cdpPort: '19300',
      cdpEndpoint: 'http://localhost:19300',
      currentUrl: 'https://example.com',
      memoryContext: '',
      browserPid: '12345',
      lastTask: '',
      createdAt: '1710000000000',
      lastActivityAt: '1710000000000',
    });

    const result = await getSession('proj-1');
    expect(result).toEqual({
      dbSessionId: 'db-123',
      status: 'idle',
      cdpPort: 19300,
      cdpEndpoint: 'http://localhost:19300',
      currentUrl: 'https://example.com',
      memoryContext: '',
      browserPid: 12345,
      lastTask: '',
      createdAt: 1710000000000,
      lastActivityAt: 1710000000000,
    });
  });

  it('setSession writes flattened fields to Redis hash', async () => {
    await setSession('proj-1', { status: 'working', currentUrl: 'https://test.com' });
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'session:proj-1',
      expect.objectContaining({ status: 'working', currentUrl: 'https://test.com' })
    );
  });

  it('deleteSession removes session, screenshot, messages keys and expiry entry', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({ dbSessionId: 'db-1', cdpPort: '19300' });
    await deleteSession('proj-1');
    expect(mockRedis.del).toHaveBeenCalledWith('session:proj-1', 'screenshot:proj-1', 'messages:proj-1');
    expect(mockRedis.zrem).toHaveBeenCalledWith('session:expiry', 'proj-1');
  });

  it('listSessions returns all project IDs from expiry set', async () => {
    mockRedis.zrange.mockResolvedValueOnce(['proj-1', 'proj-2']);
    const result = await listSessions();
    expect(result).toEqual(['proj-1', 'proj-2']);
    expect(mockRedis.zrange).toHaveBeenCalledWith('session:expiry', 0, -1);
  });
});
