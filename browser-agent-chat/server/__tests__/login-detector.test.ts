import { describe, it, expect } from 'vitest';
import { buildDetectionScript, computeScore, LOGIN_THRESHOLD } from '../src/login-detector.js';

describe('Login Detector', () => {
  it('computeScore returns correct score for standard login page', () => {
    const signals = {
      hasVisiblePasswordField: true,
      hasLoginFormAction: true,
      hasSignInButton: true,
      hasPasswordNameField: false,
      hasUsernameField: true,
    };
    const score = computeScore(signals);
    expect(score).toBe(12); // 5 + 3 + 2 + 0 + 2
    expect(score >= LOGIN_THRESHOLD).toBe(true);
  });

  it('computeScore returns low score for non-login page', () => {
    const signals = {
      hasVisiblePasswordField: false,
      hasLoginFormAction: false,
      hasSignInButton: false,
      hasPasswordNameField: false,
      hasUsernameField: false,
    };
    const score = computeScore(signals);
    expect(score).toBe(0);
    expect(score >= LOGIN_THRESHOLD).toBe(false);
  });

  it('password field alone meets threshold', () => {
    const signals = {
      hasVisiblePasswordField: true,
      hasLoginFormAction: false,
      hasSignInButton: false,
      hasPasswordNameField: false,
      hasUsernameField: false,
    };
    const score = computeScore(signals);
    expect(score).toBe(5);
    expect(score >= LOGIN_THRESHOLD).toBe(true);
  });

  it('buildDetectionScript returns a string', () => {
    const script = buildDetectionScript();
    expect(typeof script).toBe('string');
    expect(script).toContain('input[type="password"]');
  });
});
