import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { Observability } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import { agentTaskWorkflow } from './workflows/agent-task.js';
import { multiStepWorkflow } from './workflows/multi-step.js';
import { singleShotWorkflow } from './workflows/single-shot.js';

// ---------------------------------------------------------------------------
// Telemetry (Langfuse)
// ---------------------------------------------------------------------------

const {
  LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY,
  LANGFUSE_BASE_URL,
} = process.env;

const telemetryEnabled = Boolean(LANGFUSE_PUBLIC_KEY);

const observability = telemetryEnabled
  ? new Observability({
      configs: {
        langfuse: {
          serviceName: 'browser-agent-chat',
          exporters: [
            new LangfuseExporter({
              publicKey: LANGFUSE_PUBLIC_KEY,
              secretKey: LANGFUSE_SECRET_KEY,
              baseUrl: LANGFUSE_BASE_URL,
            }),
          ],
        },
      },
    })
  : undefined;

// ---------------------------------------------------------------------------
// Storage — required for suspend/resume workflow support
//
// For now, always use InMemoryStore. A Redis adapter will be added in Phase 3.
// ---------------------------------------------------------------------------

function createStorage() {
  return new InMemoryStore();
}

// ---------------------------------------------------------------------------
// Mastra instance
// ---------------------------------------------------------------------------

export const mastra = new Mastra({
  ...(observability ? { observability } : {}),
  storage: createStorage(),
  workflows: {
    agentTaskWorkflow,
    multiStepWorkflow,
    singleShotWorkflow,
  },
});
