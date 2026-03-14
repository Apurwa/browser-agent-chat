import { listFeatures, listFindings, createEvalCase } from '../db.js';
import type { EvalCase, Check } from '../types.js';

interface SeedResult {
  created: number;
  skipped: number;
  cases: Array<{ name: string; source_type: string }>;
}

export async function seedEvalCases(projectId: string): Promise<SeedResult> {
  const result: SeedResult = { created: 0, skipped: 0, cases: [] };

  // Seed from features (features include nested flows via listFeatures)
  const features = await listFeatures(projectId);
  for (const feature of features) {
    if (feature.expected_behaviors?.length) {
      for (const behavior of feature.expected_behaviors) {
        const name = `${feature.name}: ${behavior}`;
        const created = await createEvalCase({
          project_id: projectId,
          name,
          task_prompt: `Test the "${feature.name}" feature. Verify: ${behavior}`,
          source_type: 'feature',
          source_id: feature.id,
          checks: [] as Check[],
          llm_judge_criteria: `Verify that: ${behavior}`,
          tags: ['seeded', 'feature'],
          status: 'active',
        });
        if (created) {
          result.created++;
          result.cases.push({ name, source_type: 'feature' });
        } else {
          result.skipped++;
        }
      }
    }

    // Seed from flows embedded in each feature
    if (feature.flows?.length) {
      for (const flow of feature.flows) {
        const name = `Flow: ${flow.name}`;
        const checks: Check[] = [];
        const criteria = flow.checkpoints?.length
          ? `Verify these checkpoints are met: ${flow.checkpoints.map(c => c.description).join('; ')}`
          : null;

        const created = await createEvalCase({
          project_id: projectId,
          name,
          task_prompt: `Complete the flow: ${flow.name}. Steps: ${
            flow.steps?.length
              ? flow.steps.map(s => s.description).join(' → ')
              : 'follow the standard flow'
          }`,
          source_type: 'flow',
          source_id: flow.id,
          checks,
          llm_judge_criteria: criteria,
          tags: ['seeded', 'flow'],
          status: 'active',
        });
        if (created) {
          result.created++;
          result.cases.push({ name, source_type: 'flow' });
        } else {
          result.skipped++;
        }
      }
    }
  }

  // Seed from findings (regression tests)
  // Use a high limit to fetch all confirmed findings
  const { findings } = await listFindings(projectId, { status: 'confirmed' }, 1000, 0);
  for (const finding of findings) {
    if (!finding.steps_to_reproduce?.length) continue;

    const name = `Regression: ${finding.title}`;
    const created = await createEvalCase({
      project_id: projectId,
      name,
      task_prompt: finding.steps_to_reproduce.map(s => s.action).join('. '),
      source_type: 'finding',
      source_id: finding.id,
      checks: [] as Check[],
      llm_judge_criteria: finding.expected_behavior
        ? `Verify that: ${finding.expected_behavior}`
        : null,
      tags: ['seeded', 'regression'],
      status: 'active',
    });
    if (created) {
      result.created++;
      result.cases.push({ name, source_type: 'finding' });
    } else {
      result.skipped++;
    }
  }

  return result;
}
