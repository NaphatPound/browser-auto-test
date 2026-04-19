import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Recorder } from '../src/recorder.js';

describe('Recorder', () => {
  let r: Recorder;
  beforeEach(() => {
    r = new Recorder();
  });

  it('does not record when not started', () => {
    r.navigate('https://example.com');
    expect(r.getSteps()).toHaveLength(0);
  });

  it('records navigation, click and fill', () => {
    r.start('https://example.com');
    r.navigate('https://example.com/login');
    r.capture('click', { attrs: { id: 'login-btn' } });
    r.capture('fill', { attrs: { name: 'username' } }, { text: 'alice' });

    const steps = r.getSteps();
    expect(steps).toHaveLength(3);
    expect(steps[0].type).toBe('navigate');
    expect(steps[1].type).toBe('click');
    expect(steps[1].locator?.value).toBe('login-btn');
    expect(steps[2].text).toBe('alice');
  });

  it('stops recording when stopped', () => {
    r.start();
    r.capture('click', { attrs: { id: 'a' } });
    r.stop();
    r.capture('click', { attrs: { id: 'b' } });
    expect(r.getSteps()).toHaveLength(1);
  });

  it('updates and removes steps', () => {
    r.start();
    r.capture('fill', { attrs: { id: 'email' } }, { text: 'old' });
    const id = r.getSteps()[0].id;

    expect(r.updateStep(id, { text: 'new@example.com' })).toBe(true);
    expect(r.getSteps()[0].text).toBe('new@example.com');

    expect(r.removeStep(id)).toBe(true);
    expect(r.getSteps()).toHaveLength(0);
  });

  it('reorders steps', () => {
    r.start();
    r.capture('click', { attrs: { id: 'a' } });
    r.capture('click', { attrs: { id: 'b' } });
    r.capture('click', { attrs: { id: 'c' } });

    expect(r.reorder(0, 2)).toBe(true);
    const ids = r.getSteps().map((s) => s.locator?.value);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('rejects invalid reorder indices', () => {
    r.start();
    r.capture('click', { attrs: { id: 'a' } });
    expect(r.reorder(0, 5)).toBe(false);
    expect(r.reorder(-1, 0)).toBe(false);
  });

  describe('insertStep()', () => {
    it('inserts between two existing steps and returns the new id', () => {
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      r.capture('click', { attrs: { id: 'c' } });

      const newId = r.insertStep(1, { type: 'wait', timeoutMs: 500 });
      expect(newId).toBeTypeOf('string');

      const steps = r.getSteps();
      expect(steps).toHaveLength(3);
      expect(steps[0].locator?.value).toBe('a');
      expect(steps[1].type).toBe('wait');
      expect(steps[1].id).toBe(newId);
      expect(steps[1].timeoutMs).toBe(500);
      expect(steps[2].locator?.value).toBe('c');
    });

    it('appends when index >= length', () => {
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      r.insertStep(99, { type: 'wait', timeoutMs: 100 });
      const steps = r.getSteps();
      expect(steps).toHaveLength(2);
      expect(steps[1].type).toBe('wait');
    });

    it('prepends when index < 0', () => {
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      r.insertStep(-5, { type: 'wait', timeoutMs: 100 });
      expect(r.getSteps()[0].type).toBe('wait');
    });

    it('fires subscribers', () => {
      r.start();
      const cb = vi.fn();
      r.subscribe(cb);
      r.insertStep(0, { type: 'wait', timeoutMs: 100 });
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicateStep()', () => {
    it('inserts a deep copy directly after the source and returns its id', () => {
      r.start();
      r.capture('fill', { attrs: { name: 'username' } }, { text: 'alice' });
      r.capture('click', { attrs: { id: 'submit' } });

      const srcId = r.getSteps()[0].id;
      const newId = r.duplicateStep(srcId);
      expect(newId).toBeTypeOf('string');
      expect(newId).not.toBe(srcId);

      const steps = r.getSteps();
      expect(steps).toHaveLength(3);
      expect(steps[0].id).toBe(srcId);
      expect(steps[1].id).toBe(newId);
      expect(steps[1].type).toBe('fill');
      expect(steps[1].text).toBe('alice');
      expect(steps[1].locator).toEqual(steps[0].locator);
      expect(steps[2].locator?.value).toBe('submit');
    });

    it('returns null and does not emit when the id does not exist', () => {
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      const cb = vi.fn();
      r.subscribe(cb);
      expect(r.duplicateStep('nope')).toBeNull();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  it('builds a TestSuite', () => {
    r.start('https://app.test');
    r.navigate('https://app.test');
    const suite = r.toSuite('login flow');
    expect(suite.name).toBe('login flow');
    expect(suite.baseUrl).toBe('https://app.test');
    expect(suite.steps).toHaveLength(1);
    expect(suite.createdAt).toBeTypeOf('string');
  });

  describe('subscribe()', () => {
    it('fires on start, capture, and stop with current state', () => {
      const calls: { recording: boolean; len: number; baseUrl?: string }[] = [];
      r.subscribe((s) => calls.push({ recording: s.recording, len: s.steps.length, baseUrl: s.baseUrl }));

      r.start('https://app.test');
      r.capture('click', { attrs: { id: 'btn' } });
      r.stop();

      expect(calls).toEqual([
        { recording: true, len: 0, baseUrl: 'https://app.test' },
        { recording: true, len: 1, baseUrl: 'https://app.test' },
        { recording: false, len: 1, baseUrl: 'https://app.test' },
      ]);
    });

    it('does not fire when recording is off and capture is a no-op', () => {
      const cb = vi.fn();
      r.subscribe(cb);
      r.capture('click', { attrs: { id: 'x' } }); // ignored, not recording
      expect(cb).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function that detaches the listener', () => {
      const cb = vi.fn();
      const off = r.subscribe(cb);
      r.start();
      expect(cb).toHaveBeenCalledTimes(1);
      off();
      r.capture('click', { attrs: { id: 'a' } });
      r.stop();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires for updateStep, removeStep, and reorder mutations', () => {
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      r.capture('click', { attrs: { id: 'b' } });
      const cb = vi.fn();
      r.subscribe(cb);

      const id = r.getSteps()[0].id;
      r.updateStep(id, { text: 'changed' });
      r.reorder(0, 1);
      r.removeStep(id);
      expect(cb).toHaveBeenCalledTimes(3);
    });

    it('does not fire removeStep when the id does not exist (no-op)', () => {
      r.start();
      const cb = vi.fn();
      r.subscribe(cb);
      const ok = r.removeStep('nope');
      expect(ok).toBe(false);
      expect(cb).not.toHaveBeenCalled();
    });

    it('skips clear() emit when there are no steps to clear', () => {
      r.start();
      const cb = vi.fn();
      r.subscribe(cb);
      r.clear();
      expect(cb).not.toHaveBeenCalled();
    });

    it('passes a defensive copy of steps (mutation does not leak)', () => {
      let captured: import('../src/types.js').Step[] | undefined;
      r.subscribe((s) => {
        captured = s.steps;
      });
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      captured!.push({ id: 'fake', type: 'click' });
      expect(r.getSteps()).toHaveLength(1);
    });

    it('isolates listener errors so a thrown listener does not break the recorder', () => {
      r.subscribe(() => {
        throw new Error('boom');
      });
      const cb = vi.fn();
      r.subscribe(cb);
      r.start();
      r.capture('click', { attrs: { id: 'a' } });
      expect(cb).toHaveBeenCalledTimes(2);
      expect(r.getSteps()).toHaveLength(1);
    });
  });
});
