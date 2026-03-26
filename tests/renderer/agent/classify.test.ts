// tests/renderer/agent/classify.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from '../../../src/main/agent/classify';

describe('classify', () => {
  it('detects browser group', () => {
    expect(classify('search the web for cats').toolGroup).toBe('browser');
    expect(classify('navigate to https://example.com').toolGroup).toBe('browser');
  });

  it('detects coding group', () => {
    expect(classify('refactor this typescript function').toolGroup).toBe('coding');
    expect(classify('debug the python script').toolGroup).toBe('coding');
  });

  it('detects core group', () => {
    expect(classify('read the file at /tmp/foo.txt').toolGroup).toBe('core');
    expect(classify('write output to a folder').toolGroup).toBe('core');
  });

  it('detects desktop group', () => {
    expect(classify('take a screenshot').toolGroup).toBe('desktop');
    expect(classify('click the button').toolGroup).toBe('desktop');
  });

  it('defaults to full group', () => {
    expect(classify('help me').toolGroup).toBe('full');
  });

  it('detects fast model tier', () => {
    expect(classify('quick summary please').modelTier).toBe('fast');
    expect(classify('just a brief note').modelTier).toBe('fast');
  });

  it('detects powerful model tier for desktop', () => {
    expect(classify('click the save button').modelTier).toBe('powerful');
  });

  it('detects powerful model tier for keywords', () => {
    expect(classify('do a thorough analysis').modelTier).toBe('powerful');
  });

  it('defaults to standard model tier', () => {
    expect(classify('list my files').modelTier).toBe('standard');
  });

  it('detects greetings', () => {
    expect(classify('hello').isGreeting).toBe(true);
    expect(classify('hi there!').isGreeting).toBe(true);
    expect(classify('hello can you help').isGreeting).toBe(false);
  });

  it('forced profile overrides classification', () => {
    const result = classify('search the web', { toolGroup: 'core' });
    expect(result.toolGroup).toBe('core');
  });
});
