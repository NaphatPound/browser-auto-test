import type { Step, StepType, TestSuite } from './types.js';
import { pickLocator, type LocatorCandidate } from './locator.js';

let counter = 0;
const nextId = (): string => `step_${Date.now()}_${++counter}`;

export interface RecorderState {
  steps: Step[];
  recording: boolean;
  baseUrl?: string;
}

export type RecorderListener = (state: RecorderState) => void;

export class Recorder {
  private steps: Step[] = [];
  private recording = false;
  private baseUrl?: string;
  private listeners: Set<RecorderListener> = new Set();

  start(baseUrl?: string): void {
    this.recording = true;
    this.baseUrl = baseUrl;
    this.emit();
  }

  stop(): void {
    this.recording = false;
    this.emit();
  }

  isRecording(): boolean {
    return this.recording;
  }

  /** Append a navigation step. */
  navigate(url: string): void {
    if (!this.recording) return;
    this.steps.push({ id: nextId(), type: 'navigate', url });
    this.emit();
  }

  /** Capture a DOM event into a step. */
  capture(
    type: Exclude<StepType, 'navigate' | 'wait'>,
    target: LocatorCandidate,
    extra: { text?: string; key?: string; selectValue?: string } = {},
  ): void {
    if (!this.recording) return;
    const locator = pickLocator(target);
    this.steps.push({ id: nextId(), type, locator, ...extra });
    this.emit();
  }

  wait(timeoutMs: number): void {
    if (!this.recording) return;
    this.steps.push({ id: nextId(), type: 'wait', timeoutMs });
    this.emit();
  }

  /** Get a copy of recorded steps. */
  getSteps(): Step[] {
    return this.steps.slice();
  }

  /** Update an existing step (Visual Step Editor — edit). */
  updateStep(id: string, patch: Partial<Step>): boolean {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i === -1) return false;
    this.steps[i] = { ...this.steps[i], ...patch, id: this.steps[i].id };
    this.emit();
    return true;
  }

  /** Remove a step (Visual Step Editor — delete). */
  removeStep(id: string): boolean {
    const before = this.steps.length;
    this.steps = this.steps.filter((s) => s.id !== id);
    const changed = this.steps.length !== before;
    if (changed) this.emit();
    return changed;
  }

  /** Reorder by moving step at `from` to index `to`. */
  reorder(from: number, to: number): boolean {
    if (from < 0 || from >= this.steps.length) return false;
    if (to < 0 || to >= this.steps.length) return false;
    const [item] = this.steps.splice(from, 1);
    this.steps.splice(to, 0, item);
    this.emit();
    return true;
  }

  /** Insert a new step at a specific index. */
  insertStep(index: number, step: Omit<Step, 'id'>): string {
    const id = nextId();
    const newStep: Step = { ...step, id };
    if (index < 0) {
      this.steps.unshift(newStep);
    } else if (index >= this.steps.length) {
      this.steps.push(newStep);
    } else {
      this.steps.splice(index, 0, newStep);
    }
    this.emit();
    return id;
  }

  /** Duplicate an existing step. */
  duplicateStep(id: string): string | null {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i === -1) return null;
    const original = this.steps[i];
    const newId = nextId();
    const copy: Step = { ...original, id: newId };
    this.steps.splice(i + 1, 0, copy);
    this.emit();
    return newId;
  }

  clear(): void {
    if (this.steps.length === 0) return;
    this.steps = [];
    this.emit();
  }

  toSuite(name: string): TestSuite {
    return {
      name,
      baseUrl: this.baseUrl,
      steps: this.getSteps(),
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Subscribe to state changes. Listener fires after every mutation
   * (start/stop, capture, navigate, wait, update, remove, reorder, clear).
   * Returns an unsubscribe function.
   */
  subscribe(listener: RecorderListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const state: RecorderState = {
      steps: this.getSteps(),
      recording: this.recording,
      baseUrl: this.baseUrl,
    };
    for (const l of this.listeners) {
      try {
        l(state);
      } catch {
        // listener errors must not break the recorder
      }
    }
  }
}
