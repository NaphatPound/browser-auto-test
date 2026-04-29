export type StepType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'press'
  | 'hover'
  | 'check'
  | 'uncheck'
  | 'select'
  | 'wait'
  | 'comment'
  | 'assertText'
  | 'assertVisible';

export interface Locator {
  strategy: 'testId' | 'id' | 'name' | 'ariaLabel' | 'text' | 'css';
  value: string;
}

export interface Step {
  id: string;
  type: StepType;
  locator?: Locator;
  url?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
  selectValue?: string;
  note?: string;
}

export interface TestSuite {
  name: string;
  baseUrl?: string;
  summary?: string;
  steps: Step[];
  createdAt: string;
}

export type Framework = 'playwright' | 'puppeteer' | 'cypress';
