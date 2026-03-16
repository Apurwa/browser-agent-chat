import { describe, it, expect } from 'vitest';
import { buildTaskPrompt } from '../src/memory-engine.js';

describe('Credential Guardrail — prompt policy', () => {
  const prompt = buildTaskPrompt('Log in to the dashboard', 'No product knowledge yet.');

  it('includes CREDENTIAL POLICY block', () => {
    expect(prompt).toContain('CREDENTIAL POLICY');
  });

  it('forbids fabricating credentials', () => {
    expect(prompt).toContain('Do NOT enter, fabricate, or guess any credentials');
  });

  it('forbids common test credentials', () => {
    expect(prompt).toContain('admin/admin');
    expect(prompt).toContain('test@test.com');
    expect(prompt).toContain('password123');
  });

  it('forbids typing into password fields', () => {
    expect(prompt).toContain('Do NOT type into password or username fields');
  });

  it('forbids repeated wait actions', () => {
    expect(prompt).toContain('Do NOT take repeated "wait" actions');
  });

  it('instructs agent to report LOGIN_REQUIRED then continue', () => {
    expect(prompt).toContain('LOGIN_REQUIRED');
    expect(prompt).toContain('then continue with your task');
  });

  it('mentions secure credential vault', () => {
    expect(prompt).toContain('secure credential vault');
  });

  it('preserves existing task instructions', () => {
    expect(prompt).toContain('TASK: Log in to the dashboard');
    expect(prompt).toContain('FINDING_JSON');
    expect(prompt).toContain('MEMORY_JSON');
  });
});
