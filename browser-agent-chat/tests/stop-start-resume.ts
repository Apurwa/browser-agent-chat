/**
 * E2E test: Stop → Start resumes at same screen with chat preserved.
 *
 * Run:  npx tsx tests/stop-start-resume.ts
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const APP_URL = 'http://localhost:5174';
const AUTH_STATE_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), '.auth-state.json');

async function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  PASS: ${msg}`);
}

async function run() {
  const hasAuth = fs.existsSync(AUTH_STATE_PATH);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(
    hasAuth ? { storageState: AUTH_STATE_PATH } : undefined
  );
  const page = await context.newPage();

  // Navigate to app
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');

  // Handle login if needed
  const onLogin = page.url().includes('/login') ||
    await page.locator('text=Continue with GitHub').isVisible().catch(() => false);

  if (onLogin) {
    console.log('\n=== MANUAL LOGIN REQUIRED ===');
    console.log('Please log in via the browser window. Waiting up to 120s...\n');
    await page.waitForURL('**/projects**', { timeout: 120_000 });
    await context.storageState({ path: AUTH_STATE_PATH });
    console.log('Auth state saved.\n');
  }

  // Should be on /projects
  await page.waitForURL('**/projects**', { timeout: 10_000 });
  console.log('On projects page');

  // Click the first project
  const projectCard = page.locator('.project-card').first();
  await projectCard.waitFor({ state: 'visible', timeout: 10_000 });
  const projectName = await projectCard.locator('h2, h3, .project-name').first().textContent();
  console.log(`Clicking project: ${projectName}`);
  await projectCard.click();

  // Wait for testing view
  await page.waitForURL('**/testing**', { timeout: 10_000 });
  console.log('On testing view');

  // --- STEP 1: Start Agent ---
  const startBtn = page.locator('button:has-text("Start Agent")');
  if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    console.log('\n--- Step 1: Start Agent ---');
    await startBtn.click();
  }

  // Wait for screenshot to appear
  console.log('Waiting for screenshot...');
  const screenshotImg = page.locator('.browser-screenshot');
  await screenshotImg.waitFor({ state: 'visible', timeout: 60_000 });
  console.log('Screenshot appeared');

  // Wait for idle
  const statusText = page.locator('.status-text');
  await page.waitForFunction(
    () => document.querySelector('.status-text')?.textContent === 'idle',
    { timeout: 60_000 }
  );
  console.log('Agent is idle');

  // Record state
  const urlBefore = await page.locator('.browser-url-bar').textContent() || '';
  const msgCountBefore = await page.locator('.chat-message').count();
  console.log(`State before stop: URL="${urlBefore}", messages=${msgCountBefore}`);

  await assert(msgCountBefore > 0, 'Have chat messages before stop');

  // --- STEP 2: Stop Agent ---
  console.log('\n--- Step 2: Stop Agent ---');
  await page.locator('.btn-stop, button:has-text("Stop")').click();

  // Wait for disconnected
  await page.waitForFunction(
    () => document.querySelector('.status-text')?.textContent === 'disconnected',
    { timeout: 10_000 }
  );
  console.log('Agent stopped (disconnected)');

  // Assertions after stop
  const msgCountAfterStop = await page.locator('.chat-message').count();
  await assert(msgCountAfterStop === msgCountBefore, `Chat messages preserved after stop (${msgCountAfterStop} === ${msgCountBefore})`);

  const screenshotVisibleAfterStop = await screenshotImg.isVisible();
  await assert(screenshotVisibleAfterStop, 'Screenshot still visible after stop');

  const launchingVisible = await page.locator('text=Launching browser').isVisible();
  await assert(!launchingVisible, 'No "Launching browser" text after stop');

  // --- STEP 3: Restart Agent ---
  console.log('\n--- Step 3: Restart Agent ---');
  const startBtn2 = page.locator('button:has-text("Start Agent")');
  await startBtn2.waitFor({ state: 'visible', timeout: 5_000 });
  await startBtn2.click();

  // Wait a second for state updates
  await page.waitForTimeout(1_500);

  // Assertions during restart
  const launchingVisibleRestart = await page.locator('text=Launching browser').isVisible();
  await assert(!launchingVisibleRestart, 'No "Launching browser" screen on restart');

  const msgCountDuringRestart = await page.locator('.chat-message').count();
  await assert(msgCountDuringRestart >= msgCountBefore, `Chat messages preserved during restart (${msgCountDuringRestart} >= ${msgCountBefore})`);

  const screenshotVisibleRestart = await screenshotImg.isVisible();
  await assert(screenshotVisibleRestart, 'Screenshot visible during restart (dimmed old one)');

  // Check the dimming class is applied
  const hasDim = await screenshotImg.evaluate(el => el.classList.contains('browser-screenshot-reconnecting'));
  console.log(`  INFO: Screenshot has reconnecting class: ${hasDim}`);

  // Wait for agent to be idle again
  console.log('\nWaiting for agent to become idle...');
  await page.waitForFunction(
    () => document.querySelector('.status-text')?.textContent === 'idle',
    { timeout: 60_000 }
  );
  console.log('Agent is idle again');

  // URL should match
  const urlAfter = await page.locator('.browser-url-bar').textContent() || '';
  console.log(`URL before: "${urlBefore}"`);
  console.log(`URL after:  "${urlAfter}"`);
  await assert(urlAfter === urlBefore, `URL preserved after restart`);

  // Screenshot should be fully visible (no dim class)
  const hasDimAfter = await screenshotImg.evaluate(el => el.classList.contains('browser-screenshot-reconnecting'));
  await assert(!hasDimAfter, 'Screenshot fully restored, no dimming');

  console.log('\n=== ALL TESTS PASSED ===\n');

  await browser.close();
}

run().catch(err => {
  console.error('\nTEST CRASHED:', err.message);
  process.exit(1);
});
