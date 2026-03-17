import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  function MockRedis() {
    return mockRedis;
  }
  return {
    default: MockRedis,
    Redis: MockRedis,
  };
});

import {
  connect,
  getSession,
  setSession,
  deleteSession,
  listSessions,
  pushMessage,
  getMessages,
  setScreenshot,
  getScreenshot,
  allocatePort,
  freePort,
  pollExpiredSessions,
  shutdown,
  refreshTTL,
  updateLastActivity,
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
      detachedAt: '0',
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
      detachedAt: 0,
      taskCount: 0,
      navigationCount: 0,
      healthStatus: 'healthy',
      owner: '',
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

describe('redisStore — messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('pushMessage appends JSON to list and trims to 200', async () => {
    const msg = { id: '1', type: 'user' as const, content: 'hello', timestamp: 1000 };
    await pushMessage('proj-1', msg);
    expect(mockRedis.rpush).toHaveBeenCalledWith('messages:proj-1', JSON.stringify(msg));
    expect(mockRedis.ltrim).toHaveBeenCalledWith('messages:proj-1', -200, -1);
  });

  it('getMessages returns parsed ChatMessage array', async () => {
    const msg1 = { id: '1', type: 'user', content: 'hi', timestamp: 1000 };
    const msg2 = { id: '2', type: 'agent', content: 'hello', timestamp: 2000 };
    mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(msg1), JSON.stringify(msg2)]);

    const result = await getMessages('proj-1');
    expect(result).toEqual([msg1, msg2]);
    expect(mockRedis.lrange).toHaveBeenCalledWith('messages:proj-1', 0, -1);
  });
});

describe('redisStore — screenshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('setScreenshot stores base64 string', async () => {
    await setScreenshot('proj-1', 'base64data');
    expect(mockRedis.set).toHaveBeenCalledWith('screenshot:proj-1', 'base64data');
  });

  it('getScreenshot returns stored value or null', async () => {
    mockRedis.get.mockResolvedValueOnce('base64data');
    const result = await getScreenshot('proj-1');
    expect(result).toBe('base64data');
  });
});

describe('redisStore — port allocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('allocatePort returns first available port via SET NX', async () => {
    mockRedis.set.mockResolvedValueOnce('OK');
    const port = await allocatePort('proj-1');
    expect(port).toBe(19300);
    expect(mockRedis.set).toHaveBeenCalledWith('browser:port:19300', 'proj-1', 'NX');
  });

  it('allocatePort skips occupied ports', async () => {
    mockRedis.set
      .mockResolvedValueOnce(null)  // port 19300 taken
      .mockResolvedValueOnce(null)  // port 19301 taken
      .mockResolvedValueOnce('OK'); // port 19302 free
    const port = await allocatePort('proj-1');
    expect(port).toBe(19302);
  });

  it('allocatePort throws when all ports exhausted', async () => {
    mockRedis.set.mockResolvedValue(null); // all ports taken
    await expect(allocatePort('proj-1')).rejects.toThrow('No available CDP ports');
  });

  it('freePort deletes the port key', async () => {
    await freePort(19300);
    expect(mockRedis.del).toHaveBeenCalledWith('browser:port:19300');
  });
});

describe('redisStore — expiry polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connect('redis://localhost:6379');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pollExpiredSessions calls callback for expired sessions every 30s', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    mockRedis.zrangebyscore.mockResolvedValueOnce(['proj-expired']);
    mockRedis.zrem.mockResolvedValueOnce(1);

    pollExpiredSessions(callback);

    // Advance 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockRedis.zrangebyscore).toHaveBeenCalledWith(
      'session:expiry', '-inf', expect.any(Number)
    );
    expect(callback).toHaveBeenCalledWith('proj-expired');
    expect(mockRedis.zrem).toHaveBeenCalledWith('session:expiry', 'proj-expired');
  });

  it('refreshTTL uses pipeline for atomic TTL refresh', async () => {
    const pipeline = mockRedis.pipeline();
    await refreshTTL('proj-1');
    expect(mockRedis.pipeline).toHaveBeenCalled();
  });
});

describe('redisStore — updateLastActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('calls hset with only lastActivityAt field', async () => {
    const agentId = 'test-agent';
    await updateLastActivity(agentId);
    expect(mockRedis.hset).toHaveBeenCalledWith(
      `session:${agentId}`,
      'lastActivityAt',
      expect.stringMatching(/^\d+$/)
    );
    // Verify it did NOT call pipeline (which refreshTTL does)
    // This confirms updateLastActivity doesn't reset TTL
    expect(mockRedis.pipeline).not.toHaveBeenCalled();
  });
});

describe('redisStore — shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect('redis://localhost:6379');
  });

  it('shutdown calls redis.quit()', async () => {
    await shutdown();
    expect(mockRedis.quit).toHaveBeenCalled();
  });
});
