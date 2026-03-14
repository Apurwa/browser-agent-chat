import { Langfuse } from 'langfuse';

let langfuse: Langfuse | null = null;

export function isLangfuseEnabled(): boolean {
  return langfuse !== null;
}

export function getLangfuse(): Langfuse | null {
  return langfuse;
}

export function initLangfuse(): void {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.log('[LANGFUSE] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY — tracing disabled');
    return;
  }

  langfuse = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3000',
  });

  console.log('[LANGFUSE] Tracing enabled');
}

export async function shutdownLangfuse(): Promise<void> {
  if (langfuse) {
    await langfuse.shutdownAsync();
    console.log('[LANGFUSE] Flushed and shut down');
  }
}
