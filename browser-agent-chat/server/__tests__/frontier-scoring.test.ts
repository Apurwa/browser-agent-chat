import { describe, it, expect } from 'vitest';
import { computeFrontierPriority } from '../src/frontier-scoring.js';

describe('computeFrontierPriority', () => {
  // --- Category weights ---

  it('gives navigation category the highest base bonus (+3)', () => {
    const nav = computeFrontierPriority('navigation', false, 0, false);
    const form = computeFrontierPriority('form', false, 0, false);
    expect(nav).toBeGreaterThan(form);
  });

  it('gives form and modal equal base bonus (+2)', () => {
    const form = computeFrontierPriority('form', false, 0, false);
    const modal = computeFrontierPriority('modal', false, 0, false);
    expect(form).toBe(modal);
  });

  it('gives button and link equal base bonus (+1)', () => {
    const button = computeFrontierPriority('button', false, 0, false);
    const link = computeFrontierPriority('link', false, 0, false);
    expect(button).toBe(link);
  });

  it('ranks categories: navigation > form = modal > button = link', () => {
    const nav = computeFrontierPriority('navigation', false, 0, false);
    const form = computeFrontierPriority('form', false, 0, false);
    const button = computeFrontierPriority('button', false, 0, false);
    expect(nav).toBeGreaterThan(form);
    expect(form).toBeGreaterThan(button);
  });

  // --- Visited penalty ---

  it('adds +3 for unvisited pages', () => {
    const unvisited = computeFrontierPriority('button', false, 0, false);
    const visited = computeFrontierPriority('button', true, 0, false);
    expect(unvisited - visited).toBe(5); // +3 vs -2 = diff of 5
  });

  it('applies -2 penalty for visited pages', () => {
    // navigation visited: base=3 + visited=-2 + depth=0 + noFail=0 = 1
    const result = computeFrontierPriority('navigation', true, 0, false);
    expect(result).toBe(1);
  });

  it('unvisited navigation at depth 0 scores 6', () => {
    // navigation=3 + unvisited=3 + depth=0 + noFail=0 = 6
    const result = computeFrontierPriority('navigation', false, 0, false);
    expect(result).toBe(6);
  });

  // --- Depth penalty ---

  it('reduces priority by 1 per depth level', () => {
    const depth0 = computeFrontierPriority('button', false, 0, false);
    const depth1 = computeFrontierPriority('button', false, 1, false);
    const depth3 = computeFrontierPriority('button', false, 3, false);
    expect(depth0 - depth1).toBe(1);
    expect(depth0 - depth3).toBe(3);
  });

  // --- Failed penalty ---

  it('applies -3 penalty for failed items', () => {
    const ok = computeFrontierPriority('button', false, 0, false);
    const failed = computeFrontierPriority('button', false, 0, true);
    expect(ok - failed).toBe(3);
  });

  // --- Intent relevance boost ---

  it('boosts by intentRelevance * 4', () => {
    const noBoost = computeFrontierPriority('button', false, 0, false);
    const boosted = computeFrontierPriority('button', false, 0, false, 0.5);
    expect(boosted - noBoost).toBe(2); // 0.5 * 4 = 2
  });

  it('max relevance (1.0) boosts by 4', () => {
    const noBoost = computeFrontierPriority('button', false, 0, false);
    const maxBoost = computeFrontierPriority('button', false, 0, false, 1.0);
    expect(maxBoost - noBoost).toBe(4);
  });

  it('undefined intentRelevance treated as 0 boost', () => {
    const noRelevance = computeFrontierPriority('button', false, 0, false);
    const zeroRelevance = computeFrontierPriority('button', false, 0, false, 0);
    const undefinedRelevance = computeFrontierPriority('button', false, 0, false, undefined);
    expect(noRelevance).toBe(zeroRelevance);
    expect(noRelevance).toBe(undefinedRelevance);
  });

  // --- Combined scenarios ---

  it('worst case: visited + deep + failed + no-relevance button scores negative', () => {
    // button=1 + visited=-2 + depth=5*-1=-5 + failed=-3 = -9
    const result = computeFrontierPriority('button', true, 5, true);
    expect(result).toBe(-9);
  });

  it('best case: navigation + unvisited + depth=0 + no-fail + full-relevance', () => {
    // navigation=3 + unvisited=3 + depth=0 + noFail=0 + relevance=1*4=4 = 10
    const result = computeFrontierPriority('navigation', false, 0, false, 1.0);
    expect(result).toBe(10);
  });
});
