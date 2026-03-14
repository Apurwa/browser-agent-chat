import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redisStore
vi.mock('../src/redisStore.js', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  refreshTTL: vi.fn().mockResolvedValue(undefined),
  freePort: vi.fn().mockResolvedValue(undefined),
  setScreenshot: vi.fn().mockResolvedValue(undefined),
  getScreenshot: vi.fn().mockResolvedValue(null),
  pushMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  getRedis: vi.fn().mockReturnValue({
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  }),
}));

// Mock browserManager
vi.mock('../src/browserManager.js', () => ({
  claimWarm: vi.fn().mockResolvedValue(null),
  launchBrowser: vi.fn().mockResolvedValue({ pid: 12345, port: 19300, cdpEndpoint: 'http://localhost:19300' }),
  killBrowser: vi.fn().mockResolvedValue(undefined),
  isAlive: vi.fn().mockResolvedValue(true),
}));

// Mock agent — factory must not reference top-level variables (hoisting rules)
vi.mock('../src/agent.js', () => ({
  createAgent: vi.fn().mockResolvedValue({
    agent: {},
    connector: {},
    sessionId: 'db-1',
    projectId: 'proj-1',
    memoryContext: 'test context',
    stepsHistory: [],
    loginDone: Promise.resolve(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock db
vi.mock('../src/db.js', () => ({
  endSession: vi.fn().mockResolvedValue(undefined),
  getMessagesBySession: vi.fn().mockResolvedValue([]),
}));

import * as redisStore from '../src/redisStore.js';
import * as browserManager from '../src/browserManager.js';
import { createAgent } from '../src/agent.js';
import {
  createSession,
  destroySession,
  getAgent,
  addClient,
  removeClient,
  makeBroadcast,
} from '../src/sessionManager.js';

describe('sessionManager — create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createSession claims warm browser first, falls back to launch', async () => {
    (browserManager.claimWarm as any).mockResolvedValueOnce(null);
    (browserManager.launchBrowser as any).mockResolvedValueOnce({
      pid: 12345, port: 19300, cdpEndpoint: 'http://localhost:19300',
    });

    await createSession('proj-1', 'https://example.com', 'db-1');

    expect(browserManager.claimWarm).toHaveBeenCalledWith('proj-1');
    expect(browserManager.launchBrowser).toHaveBeenCalledWith('proj-1');
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Function), 'http://localhost:19300', 'db-1', 'proj-1', 'https://example.com'
    );
    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      dbSessionId: 'db-1',
      status: 'idle',
      cdpPort: 19300,
      browserPid: 12345,
    }));
  });

  it('createSession uses warm browser when available', async () => {
    (browserManager.claimWarm as any).mockResolvedValueOnce({
      pid: 99999, port: 19305, cdpEndpoint: 'http://localhost:19305',
    });

    await createSession('proj-1', 'https://example.com', 'db-1');

    expect(browserManager.launchBrowser).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledWith(
      expect.any(Function), 'http://localhost:19305', 'db-1', 'proj-1', 'https://example.com'
    );
  });

  it('createSession stores agent in local map', async () => {
    await createSession('proj-1', 'https://example.com', 'db-1');
    const agent = getAgent('proj-1');
    expect(agent).toBeDefined();
    expect(agent).toHaveProperty('memoryContext', 'test context');
    expect(agent).toHaveProperty('sessionId', 'db-1');
  });
});

describe('sessionManager — destroy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('destroySession kills browser, ends DB session, deletes Redis', async () => {
    (redisStore.getSession as any).mockResolvedValueOnce({
      dbSessionId: 'db-1',
      browserPid: 12345,
      cdpPort: 19300,
    });

    // First create a session so there's an agent to clean up
    await createSession('proj-1', 'https://example.com', 'db-1');
    vi.clearAllMocks();
    (redisStore.getSession as any).mockResolvedValueOnce({
      dbSessionId: 'db-1',
      browserPid: 12345,
      cdpPort: 19300,
    });

    await destroySession('proj-1');

    expect(browserManager.killBrowser).toHaveBeenCalledWith(12345, 19300);
    expect(redisStore.deleteSession).toHaveBeenCalledWith('proj-1');
    expect(getAgent('proj-1')).toBeUndefined();
  });
});

describe('sessionManager — broadcast', () => {
  it('makeBroadcast writes screenshot to Redis', () => {
    const broadcast = makeBroadcast('proj-1');
    broadcast({ type: 'screenshot', data: 'base64img' });

    expect(redisStore.setScreenshot).toHaveBeenCalledWith('proj-1', 'base64img');
  });

  it('makeBroadcast writes nav URL to Redis', () => {
    const broadcast = makeBroadcast('proj-1');
    broadcast({ type: 'nav', url: 'https://test.com/page' });

    expect(redisStore.setSession).toHaveBeenCalledWith('proj-1', { currentUrl: 'https://test.com/page' });
  });

  it('makeBroadcast stores chat messages in Redis', () => {
    const broadcast = makeBroadcast('proj-1');
    broadcast({ type: 'thought', content: 'Analyzing the page...' });

    expect(redisStore.pushMessage).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      type: 'agent',
      content: 'Analyzing the page...',
    }));
  });
});
