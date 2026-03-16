import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { Observability } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import { agentTaskWorkflow } from './workflows/agent-task.js';

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

export const mastra = new Mastra({
  ...(observability ? { observability } : {}),
  workflows: {
    agentTaskWorkflow,
  },
});
