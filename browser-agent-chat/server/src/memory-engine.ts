import { listFeatures } from './db.js';
import type { Feature, Flow } from './types.js';

/**
 * Serialize project memory into a text prompt context block.
 */
export function serializeMemory(features: Feature[]): string {
  if (features.length === 0) {
    return 'No product knowledge recorded yet. The user may teach you about features and expected behaviors.';
  }

  const lines: string[] = ['PRODUCT KNOWLEDGE:'];
  for (const feature of features) {
    const crit = feature.criticality.toUpperCase();
    lines.push(`\n- ${feature.name} [${crit}]${feature.description ? ': ' + feature.description : ''}`);

    if (feature.expected_behaviors.length > 0) {
      lines.push('  Expected behaviors:');
      for (const b of feature.expected_behaviors) {
        lines.push(`    • ${b}`);
      }
    }

    if (feature.flows && feature.flows.length > 0) {
      lines.push('  Flows:');
      for (const flow of feature.flows) {
        const fcrit = flow.criticality.toUpperCase();
        const stepNames = flow.steps.map(s => s.description).join(' → ');
        lines.push(`    → ${flow.name} [${fcrit}]: ${stepNames}`);
        if (flow.checkpoints.length > 0) {
          for (const cp of flow.checkpoints) {
            lines.push(`      checkpoint: ${cp.description} (expected: ${cp.expected})`);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build the task prompt with memory context injected.
 */
export function buildTaskPrompt(userMessage: string, memoryContext: string): string {
  return `You are a QA agent testing a SaaS application. Here is what you know about this product:

${memoryContext}

TASK: ${userMessage}

As you perform this task:
1. If you observe anything that contradicts the expected behaviors above, report it as a FINDING by including this exact JSON in your response (on its own line):
   FINDING_JSON:{"title":"...","type":"visual|functional|data|ux","severity":"critical|high|medium|low","feature":"...","flow":"...","expected_behavior":"...","actual_behavior":"..."}
2. If the user is teaching you about the product (describing features, flows, or expected behaviors), acknowledge what you learned and include:
   MEMORY_JSON:{"action":"create_feature","data":{"name":"...","description":"...","criticality":"...","expected_behaviors":[...]}}
   MEMORY_JSON:{"action":"create_flow","data":{"feature_name":"...","name":"...","steps":["..."],"checkpoints":["..."],"criticality":"..."}}
   MEMORY_JSON:{"action":"add_behavior","data":{"feature_name":"...","behavior":"..."}}
   If you notice any new features, behaviors, or flows that aren't in the product knowledge above, report them using MEMORY_JSON.
3. Otherwise, just perform the requested task.`;
}

/**
 * Build an exploration prompt for Explore & Learn mode.
 */
export function buildExplorePrompt(context: string | null): string {
  return `Quickly explore this application. Look at the current page and navigate to 3-5 main sections visible in the navigation/sidebar. Spend no more than a few clicks per section. Note what features and pages you find.

Context about this app: ${context || 'No context provided, discover freely.'}

Guidelines:
- Click through the main navigation items (sidebar, top menu)
- Visit each main section briefly — just see what's there
- Do NOT fill out forms or interact deeply
- Do NOT navigate more than 2 levels deep
- Stop after visiting 3-5 sections`;
}

/**
 * Load memory for a project and build the serialized context.
 */
export async function loadMemoryContext(projectId: string): Promise<string> {
  const features = await listFeatures(projectId);
  return serializeMemory(features);
}
