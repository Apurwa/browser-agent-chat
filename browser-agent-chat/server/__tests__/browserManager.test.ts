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
import { launchBrowser, killBrowser, isAlive } from '../src/browserManager.js';

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
