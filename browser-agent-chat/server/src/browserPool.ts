import { chromium, type Browser } from 'playwright';

const isHeadless = process.env.HEADLESS !== 'false';

const LAUNCH_OPTIONS = {
  headless: isHeadless,
  args: [
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    ...(isHeadless ? ['--no-sandbox'] : []),
  ],
};

let warmBrowser: Browser | null = null;
let warming = false;

/** Launch a browser in the background so it's ready when needed. */
export async function warmUp(): Promise<void> {
  if (warmBrowser || warming) return;
  warming = true;
  try {
    warmBrowser = await chromium.launch(LAUNCH_OPTIONS);
    console.log('[BrowserPool] Warm browser ready');
  } catch (err) {
    console.error('[BrowserPool] Failed to warm browser:', err);
  } finally {
    warming = false;
  }
}

/** Get a ready browser instance. Returns the warm one if available, otherwise launches fresh. */
export async function acquire(): Promise<Browser> {
  if (warmBrowser?.isConnected()) {
    const browser = warmBrowser;
    warmBrowser = null;
    // Start warming the next one in the background
    warmUp().catch(() => {});
    return browser;
  }
  // No warm browser — launch on demand
  const browser = await chromium.launch(LAUNCH_OPTIONS);
  // Start warming the next one in the background
  warmUp().catch(() => {});
  return browser;
}

/** Close all pooled browsers on shutdown. */
export async function shutdown(): Promise<void> {
  if (warmBrowser?.isConnected()) {
    await warmBrowser.close();
    warmBrowser = null;
  }
}
