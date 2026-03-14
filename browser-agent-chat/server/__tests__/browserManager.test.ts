import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process — use vi.hoisted so mockChild is available when vi.mock factory runs
const { mockChild } = vi.hoisted(() => {
  return { mockChild: { pid: 99999, unref: vi.fn() } };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue(mockChild),
}));

// Mock playwright
vi.mock('playwright', () => ({
  chromium: {
    executablePath: vi.fn().mockReturnValue('/usr/bin/chromium'),
  },
}));

// Mock redisStore
vi.mock('../src/redisStore.js', () => ({
  allocatePort: vi.fn().mockResolvedValue(19300),
  freePort: vi.fn().mockResolvedValue(undefined),
  getRedis: vi.fn().mockReturnValue({
    spop: vi.fn().mockResolvedValue(null),
    sadd: vi.fn().mockResolvedValue(1),
    scard: vi.fn().mockResolvedValue(0),
    smembers: vi.fn().mockResolvedValue([]),
    srem: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  }),
}));

// Mock fetch for CDP health checks
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { spawn } from 'node:child_process';
import * as redisStore from '../src/redisStore.js';
import { launchBrowser, killBrowser, isAlive, claimWarm, warmUp, cleanupOrphanedWarm } from '../src/browserManager.js';

describe('browserManager — launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make waitForCDP succeed immediately
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('launchBrowser spawns detached process and returns pid/port/endpoint', async () => {
    const result = await launchBrowser('proj-1');

    expect(redisStore.allocatePort).toHaveBeenCalledWith('proj-1');
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/chromium',
      expect.arrayContaining(['--remote-debugging-port=19300']),
      { detached: true, stdio: 'ignore' }
    );
    expect(mockChild.unref).toHaveBeenCalled();
    expect(result).toEqual({
      pid: 99999,
      port: 19300,
      cdpEndpoint: 'http://localhost:19300',
    });
  });
});

describe('browserManager — kill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('killBrowser sends SIGTERM then frees port when process exits quickly', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) throw new Error('ESRCH'); // process is dead after SIGTERM
      return true;
    });

    await killBrowser(12345, 19300);

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(redisStore.freePort).toHaveBeenCalledWith(19300);
    killSpy.mockRestore();
  });

  it('killBrowser sends SIGKILL after 3s if process survives SIGTERM', async () => {
    let killCount = 0;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 'SIGTERM') return true;
      if (signal === 0) {
        killCount++;
        if (killCount > 15) throw new Error('ESRCH'); // dies after SIGKILL
        return true; // process still alive
      }
      if (signal === 'SIGKILL') return true;
      return true;
    });

    await killBrowser(12345, 19300);

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(redisStore.freePort).toHaveBeenCalledWith(19300);
    killSpy.mockRestore();
  });

  it('launchBrowser throws if spawn fails (no pid)', async () => {
    const { spawn: mockSpawn } = await import('node:child_process');
    (mockSpawn as any).mockReturnValueOnce({ pid: undefined, unref: vi.fn() });

    await expect(launchBrowser('proj-1')).rejects.toThrow('Failed to spawn');
  });
});

describe('browserManager — isAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when process exists and CDP responds', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true); // process exists
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await isAlive(12345, 19300);
    expect(result).toBe(true);

    vi.restoreAllMocks();
  });

  it('returns false when process does not exist', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });

    const result = await isAlive(12345, 19300);
    expect(result).toBe(false);

    vi.restoreAllMocks();
  });

  it('returns false when CDP does not respond', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await isAlive(12345, 19300);
    expect(result).toBe(false);

    vi.restoreAllMocks();
  });
});

describe('browserManager — warm pool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('claimWarm returns null when no warm browsers available', async () => {
    const redis = redisStore.getRedis();
    (redis.spop as any).mockResolvedValueOnce(null);

    const result = await claimWarm('proj-1');
    expect(result).toBeNull();
  });

  it('claimWarm returns browser info and reassigns port when warm browser alive', async () => {
    const redis = redisStore.getRedis();
    (redis.spop as any).mockResolvedValueOnce('88888:19305');

    // isAlive check: process exists + CDP responds
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await claimWarm('proj-1');
    expect(result).toEqual({
      pid: 88888,
      port: 19305,
      cdpEndpoint: 'http://localhost:19305',
    });
    // Port reassigned to project
    expect(redis.set).toHaveBeenCalledWith('browser:port:19305', 'proj-1');

    vi.restoreAllMocks();
  });

  it('claimWarm skips dead warm browser and returns null', async () => {
    const redis = redisStore.getRedis();
    (redis.spop as any).mockResolvedValueOnce('77777:19310');

    // isAlive: process dead
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });

    const result = await claimWarm('proj-1');
    expect(result).toBeNull();
    expect(redisStore.freePort).toHaveBeenCalledWith(19310);

    vi.restoreAllMocks();
  });

  it('cleanupOrphanedWarm kills dead warm browsers and leaves alive ones', async () => {
    const redis = redisStore.getRedis();
    (redis.smembers as any).mockResolvedValueOnce(['11111:19300', '22222:19301']);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 11111 && signal === 0) return true; // alive
      if (pid === 22222 && signal === 0) throw new Error('ESRCH'); // dead
      if (pid === 22222 && signal === 'SIGKILL') return true;
      return true;
    });

    // First is alive (CDP responds), second is dead
    mockFetch
      .mockResolvedValueOnce({ ok: true })  // 11111 CDP check
      // 22222 skipped — process.kill(0) throws

    await cleanupOrphanedWarm();

    // Dead one should be removed from set and port freed
    expect(redis.srem).toHaveBeenCalledWith('browser:warm:pids', '22222:19301');
    expect(redisStore.freePort).toHaveBeenCalledWith(19301);

    // Alive one should NOT be removed
    expect(redis.srem).not.toHaveBeenCalledWith('browser:warm:pids', '11111:19300');

    killSpy.mockRestore();
  });

  it('warmUp launches browsers and registers in warm set', async () => {
    const redis = redisStore.getRedis();
    (redis.scard as any).mockResolvedValueOnce(0); // no warm browsers yet

    await warmUp(1);

    expect(redisStore.allocatePort).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
    expect(redis.sadd).toHaveBeenCalledWith(
      'browser:warm:pids',
      expect.stringMatching(/^\d+:\d+$/)
    );
  });
});
