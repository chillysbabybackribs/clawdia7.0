/**
 * RunTelemetry simulation tests.
 *
 * Exercises the telemetry helper against representative multi-step scenarios and
 * captures structured output so we can observe what the instrumentation actually
 * emits during realistic flows.  No real network calls — pure unit simulation.
 */

import { describe, it, expect } from 'vitest';
import { RunTelemetry } from '../../../../src/main/core/telemetry/RunTelemetry';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTelemetry(runId = 'run-sim-001'): RunTelemetry {
  return new RunTelemetry(runId, 'anthropic', 'claude-sonnet-4-6');
}

// ── Browser multi-step scenario ───────────────────────────────────────────────

describe('RunTelemetry — browser multi-step flow', () => {
  it('records 5-turn browser scraping task correctly', () => {
    const t = makeTelemetry('run-browser-001');
    // Turn 0: navigate + extract_text (large page → truncated)
    t.beginTurn();
    let nav = t.beginToolCall('browser.navigate', 'browser', 'navigate', { url: 'https://news.ycombinator.com' });
    t.recordToolCall(0, 'browser.navigate', 'browser', 'navigate', nav.startMs, nav.callKey, true, false, 320, 320);
    let ext = t.beginToolCall('browser.extract_text', 'browser', 'extract_text', {});
    t.recordToolCall(0, 'browser.extract_text', 'browser', 'extract_text', ext.startMs, ext.callKey, true, false, 85000, 6013); // truncated
    t.recordTurn(0, 2, false);

    // Turn 1: list_tabs (unnecessary — already know we're on HN)
    t.beginTurn();
    let lt1 = t.beginToolCall('browser.list_tabs', 'browser', 'list_tabs', {});
    t.recordToolCall(1, 'browser.list_tabs', 'browser', 'list_tabs', lt1.startMs, lt1.callKey, true, false, 210, 210);
    t.recordTurn(1, 1, false);

    // Turn 2: new_tab, navigate to first story
    t.beginTurn();
    let nt = t.beginToolCall('browser.new_tab', 'browser', 'new_tab', { url: 'https://example.com/story1' });
    t.recordToolCall(2, 'browser.new_tab', 'browser', 'new_tab', nt.startMs, nt.callKey, true, false, 180, 180);
    t.recordTurn(2, 1, false);

    // Turn 3: list_tabs AGAIN (rediscovery — model forgot tab IDs)
    t.beginTurn();
    let lt2 = t.beginToolCall('browser.list_tabs', 'browser', 'list_tabs', {});
    t.recordToolCall(3, 'browser.list_tabs', 'browser', 'list_tabs', lt2.startMs, lt2.callKey, true, false, 310, 310);
    t.recordTurn(3, 1, false);

    // Turn 4: switch_tab, extract_text, final text
    t.beginTurn();
    let st = t.beginToolCall('browser.switch_tab', 'browser', 'switch_tab', { tabId: 'tab-2' });
    t.recordToolCall(4, 'browser.switch_tab', 'browser', 'switch_tab', st.startMs, st.callKey, true, false, 120, 120);
    t.recordTurn(4, 1, true); // has text too

    const summary = t.finalize('success', 5);

    expect(summary.totalTurns).toBe(5);
    expect(summary.totalToolCalls).toBe(6);
    expect(summary.toolFrequency['browser.list_tabs']).toBe(2);
    expect(summary.truncationEvents).toBe(1);
    expect(summary.totalResultCharsBeforeTruncation).toBeGreaterThan(summary.totalResultCharsAfterTruncation);
    expect(summary.repeatedIdenticalCallCount).toBeGreaterThan(0); // list_tabs called twice
    expect(summary.inefficiencyFlags).toContain('repeated_browser_list_tabs');
    expect(summary.termination).toBe('success');
  });
});

// ── File system scenario ──────────────────────────────────────────────────────

describe('RunTelemetry — file system flow', () => {
  it('records fs read + shell search task', () => {
    const t = makeTelemetry('run-fs-001');

    // Turn 0: shell_exec rg to find files
    t.beginTurn();
    let rg = t.beginToolCall('shell.exec', 'shell', 'exec', { command: "rg -l 'import.*react' src/" });
    t.recordToolCall(0, 'shell.exec', 'shell', 'exec', rg.startMs, rg.callKey, true, false, 450, 450);
    t.recordTurn(0, 1, false);

    // Turn 1: fs_read_file on the found file (large file → truncated)
    t.beginTurn();
    let rf = t.beginToolCall('fs.read_file', 'fs', 'read_file', { path: '/src/renderer/App.tsx' });
    t.recordToolCall(1, 'fs.read_file', 'fs', 'read_file', rf.startMs, rf.callKey, true, false, 22000, 6013);
    t.recordTurn(1, 1, false);

    // Turn 2: fs_read_file SAME FILE AGAIN (rediscovery)
    t.beginTurn();
    let rf2 = t.beginToolCall('fs.read_file', 'fs', 'read_file', { path: '/src/renderer/App.tsx' });
    t.recordToolCall(2, 'fs.read_file', 'fs', 'read_file', rf2.startMs, rf2.callKey, true, false, 22000, 6013);
    t.recordTurn(2, 1, true);

    const summary = t.finalize('success', 3);

    expect(summary.totalTurns).toBe(3);
    expect(summary.truncationEvents).toBe(2);
    expect(summary.repeatedIdenticalCallCount).toBeGreaterThan(0);
    expect(summary.inefficiencyFlags).toContain('repeated_tool_same_payload');
  });
});

// ── Shell / CLI scenario ──────────────────────────────────────────────────────

describe('RunTelemetry — shell/CLI flow', () => {
  it('records shell command chain without approval issues', () => {
    const t = makeTelemetry('run-shell-001');

    // Turn 0: grep (now safe after Fix 5)
    t.beginTurn();
    let g = t.beginToolCall('shell.exec', 'shell', 'exec', { command: 'grep -r "console.log" src/' });
    t.recordToolCall(0, 'shell.exec', 'shell', 'exec', g.startMs, g.callKey, true, false, 1200, 1200);
    t.recordTurn(0, 1, false);

    // Turn 1: wc -l (safe)
    t.beginTurn();
    let wc = t.beginToolCall('shell.exec', 'shell', 'exec', { command: 'wc -l src/main/core/executors/ChatExecutor.ts' });
    t.recordToolCall(1, 'shell.exec', 'shell', 'exec', wc.startMs, wc.callKey, true, false, 80, 80);
    t.recordTurn(1, 1, true);

    const summary = t.finalize('success', 2);

    expect(summary.approvalsEncountered).toBe(0);
    expect(summary.errorsEncountered).toBe(0);
    expect(summary.totalTurns).toBe(2);
  });
});

// ── Desktop scenario ─────────────────────────────────────────────────────────

describe('RunTelemetry — desktop flow', () => {
  it('flags repeated desktop_list_apps and approval stalls', () => {
    const t = makeTelemetry('run-desktop-001');

    // Turn 0: list_apps
    t.beginTurn();
    let la1 = t.beginToolCall('desktop.list_apps', 'desktop', 'list_apps', {});
    t.recordToolCall(0, 'desktop.list_apps', 'desktop', 'list_apps', la1.startMs, la1.callKey, true, false, 640, 640);
    t.recordTurn(0, 1, false);

    // Turn 1: desktop_click → approval required
    t.beginTurn();
    let dc = t.beginToolCall('desktop.click', 'desktop', 'click', { x: 100, y: 200, windowId: '0x001' });
    t.recordToolCall(1, 'desktop.click', 'desktop', 'click', dc.startMs, dc.callKey, false, true, 200, 200);
    t.recordTurn(1, 1, false);

    // Turn 2: list_apps again (re-discovery while waiting)
    t.beginTurn();
    let la2 = t.beginToolCall('desktop.list_apps', 'desktop', 'list_apps', {});
    t.recordToolCall(2, 'desktop.list_apps', 'desktop', 'list_apps', la2.startMs, la2.callKey, true, false, 640, 640);
    t.recordTurn(2, 1, false);

    // Turn 3: list_apps THIRD TIME
    t.beginTurn();
    let la3 = t.beginToolCall('desktop.list_apps', 'desktop', 'list_apps', {});
    t.recordToolCall(3, 'desktop.list_apps', 'desktop', 'list_apps', la3.startMs, la3.callKey, true, false, 640, 640);
    t.recordTurn(3, 1, false);

    const summary = t.finalize('error', 4);

    expect(summary.approvalsEncountered).toBe(1);
    expect(summary.toolFrequency['desktop.list_apps']).toBe(3);
    expect(summary.inefficiencyFlags).toContain('repeated_desktop_list_apps');
    expect(summary.inefficiencyFlags).toContain('repeated_tool_same_payload');
  });
});

// ── Hybrid scenario ───────────────────────────────────────────────────────────

describe('RunTelemetry — hybrid browser + fs flow', () => {
  it('records cross-surface task and identifies max-turns termination', () => {
    const t = makeTelemetry('run-hybrid-001');

    // Simulate hitting the 30-turn limit
    for (let turn = 0; turn < 30; turn++) {
      t.beginTurn();
      const toolName = turn % 2 === 0 ? 'browser.navigate' : 'fs.read_file';
      const domain = turn % 2 === 0 ? 'browser' : 'fs';
      const action = turn % 2 === 0 ? 'navigate' : 'read_file';
      const payload = turn % 2 === 0
        ? { url: `https://example.com/page-${turn}` }
        : { path: `/tmp/file-${turn}.txt` };
      const tc = t.beginToolCall(toolName, domain, action, payload);
      t.recordToolCall(turn, toolName, domain, action, tc.startMs, tc.callKey, true, false, 500, 500);
      t.recordTurn(turn, 1, false);
    }

    const summary = t.finalize('max_turns', 30);

    expect(summary.termination).toBe('max_turns');
    expect(summary.totalTurns).toBe(30);
    expect(summary.totalToolCalls).toBe(30);
    expect(summary.toolFrequency['browser.navigate']).toBe(15);
    expect(summary.toolFrequency['fs.read_file']).toBe(15);
  });
});

// ── Truncation accuracy ────────────────────────────────────────────────────────

describe('RunTelemetry — truncation metrics', () => {
  it('correctly sums raw vs truncated sizes', () => {
    const t = makeTelemetry('run-trunc-001');

    t.beginTurn();
    const tc1 = t.beginToolCall('browser.extract_text', 'browser', 'extract_text', {});
    t.recordToolCall(0, 'browser.extract_text', 'browser', 'extract_text', tc1.startMs, tc1.callKey, true, false, 90000, 6013);
    const tc2 = t.beginToolCall('fs.read_file', 'fs', 'read_file', { path: '/large.txt' });
    t.recordToolCall(0, 'fs.read_file', 'fs', 'read_file', tc2.startMs, tc2.callKey, true, false, 50000, 6013);
    t.recordTurn(0, 2, true);

    const summary = t.finalize('success', 1);

    expect(summary.totalResultCharsBeforeTruncation).toBe(140000);
    expect(summary.totalResultCharsAfterTruncation).toBe(12026);
    expect(summary.truncationEvents).toBe(2);
  });
});
