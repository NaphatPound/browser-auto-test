import { describe, expect, it } from 'vitest';
import {
  generateMermaid,
  generateFlowNodes,
  generateFlowchartHTML,
} from '../src/flowchart.js';
import type { TestSuite } from '../src/types.js';

const sample: TestSuite = {
  name: 'login flow',
  baseUrl: 'https://example.com',
  createdAt: '2026-04-20T00:00:00.000Z',
  steps: [
    { id: 's1', type: 'navigate', url: 'https://example.com/login' },
    {
      id: 's2',
      type: 'fill',
      locator: { strategy: 'name', value: 'username' },
      text: 'alice',
    },
    { id: 's3', type: 'click', locator: { strategy: 'testId', value: 'submit' } },
    { id: 's4', type: 'assertVisible', locator: { strategy: 'text', value: 'Welcome' } },
  ],
};

describe('generateMermaid', () => {
  it('declares a top-down graph', () => {
    const out = generateMermaid(sample);
    expect(out.startsWith('graph TD')).toBe(true);
  });

  it('emits a Start node with the base URL', () => {
    const out = generateMermaid(sample);
    expect(out).toContain('Start(');
    expect(out).toContain('https://example.com');
  });

  it('emits one node per step and chains them with arrows', () => {
    const out = generateMermaid(sample);
    expect(out).toContain('step_0');
    expect(out).toContain('step_1');
    expect(out).toContain('step_2');
    expect(out).toContain('step_3');
    expect(out).toContain('Start --> step_0');
    expect(out).toContain('step_0 --> step_1');
    expect(out).toContain('step_3 --> End');
  });

  it('uses different node shapes per step type', () => {
    const out = generateMermaid(sample);
    // navigate → subroutine [[...]]
    expect(out).toMatch(/step_0\[\[.*]]/);
    // click → process [...]
    expect(out).toMatch(/step_2\[.*]/);
    // assertVisible → decision {...}
    expect(out).toMatch(/step_3\{.*}/);
  });

  it('strips characters that would break Mermaid labels', () => {
    const tricky: TestSuite = {
      name: 'tricky',
      createdAt: '2026-04-20T00:00:00.000Z',
      steps: [
        {
          id: 'x',
          type: 'fill',
          locator: { strategy: 'css', value: 'div[data-x="y"]' },
          text: 'a [b] c',
        },
      ],
    };
    const out = generateMermaid(tricky);
    // No unescaped [, ], (, ), {, } inside label text
    expect(out).not.toMatch(/Fill:.*\[.*\]/);
  });

  it('strips double quotes from typed text inside labels', () => {
    const suite: TestSuite = {
      name: 'quoted',
      createdAt: '2026-04-20T00:00:00.000Z',
      steps: [
        {
          id: 'q1',
          type: 'fill',
          locator: { strategy: 'text', value: 'c' },
          text: 'c',
        },
      ],
    };
    const out = generateMermaid(suite);
    const labelLine = out.split('\n').find((l) => l.includes('step_0'))!;
    // The node label body must not contain a raw double quote.
    const body = labelLine.slice(labelLine.indexOf('[') + 1, labelLine.lastIndexOf(']'));
    expect(body).not.toContain('"');
  });

  it('strips double quotes from locator values inside labels', () => {
    const suite: TestSuite = {
      name: 'locator quotes',
      createdAt: '2026-04-20T00:00:00.000Z',
      steps: [
        {
          id: 'q2',
          type: 'click',
          locator: { strategy: 'css', value: 'div[data-x="y"]' },
        },
      ],
    };
    const out = generateMermaid(suite);
    // The entire diagram must be quote-free inside bracketed labels.
    for (const line of out.split('\n')) {
      const open = line.indexOf('[');
      const close = line.lastIndexOf(']');
      if (open === -1 || close <= open) continue;
      const body = line.slice(open + 1, close);
      expect(body).not.toContain('"');
    }
  });

  it('produces Mermaid source that a real Mermaid parser accepts', async () => {
    // Mermaid's parser pulls in DOMPurify which needs a window/document, so
    // stand up a JSDOM to back it for the duration of this assertion.
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const g = globalThis as unknown as {
      window: Window;
      document: Document;
      navigator: Navigator;
    };
    const prev = { window: g.window, document: g.document, navigator: g.navigator };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document;
    g.navigator = dom.window.navigator;
    try {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

      const suite: TestSuite = {
        name: 'parse-check',
        createdAt: '2026-04-20T00:00:00.000Z',
        steps: [
          { id: '1', type: 'navigate', url: 'https://example.com/?q="hi"' },
          { id: '2', type: 'fill', locator: { strategy: 'text', value: 'c' }, text: 'c' },
          {
            id: '3',
            type: 'click',
            locator: { strategy: 'css', value: 'div[data-x="y"]' },
          },
        ],
      };
      const src = generateMermaid(suite);
      await expect(mermaid.parse(src)).resolves.toBeTruthy();
    } finally {
      g.window = prev.window;
      g.document = prev.document;
      g.navigator = prev.navigator;
    }
  });

  it('handles empty suite (no steps)', () => {
    const empty: TestSuite = {
      name: 'empty',
      createdAt: '2026-04-20T00:00:00.000Z',
      steps: [],
    };
    const out = generateMermaid(empty);
    expect(out).toContain('Start');
    expect(out).toContain('End');
    expect(out).toContain('Start --> End');
  });
});

describe('generateFlowNodes', () => {
  it('returns a Start node, one action node per step, and an End node', () => {
    const g = generateFlowNodes(sample);
    expect(g.nodes).toHaveLength(sample.steps.length + 2);
    expect(g.nodes[0].id).toBe('start');
    expect(g.nodes[0].type).toBe('start');
    expect(g.nodes[g.nodes.length - 1].id).toBe('end');
    expect(g.nodes[g.nodes.length - 1].type).toBe('end');
  });

  it('chains every node via edges', () => {
    const g = generateFlowNodes(sample);
    expect(g.edges).toHaveLength(sample.steps.length + 1);
    expect(g.edges[0].source).toBe('start');
    expect(g.edges[g.edges.length - 1].target).toBe('end');
    // Middle edges: source of next matches target of previous.
    for (let i = 1; i < g.edges.length; i++) {
      expect(g.edges[i].source).toBe(g.edges[i - 1].target);
    }
  });

  it('carries stepId and stepType on action nodes', () => {
    const g = generateFlowNodes(sample);
    const click = g.nodes.find((n) => n.data.stepType === 'click');
    expect(click).toBeDefined();
    expect(click?.data.stepId).toBe('s3');
  });

  it('lays nodes vertically with uniform spacing', () => {
    const g = generateFlowNodes(sample);
    const ys = g.nodes.map((n) => n.position.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });

  it('handles an empty suite (start → end only)', () => {
    const empty: TestSuite = {
      name: 'empty',
      createdAt: '2026-04-20T00:00:00.000Z',
      steps: [],
    };
    const g = generateFlowNodes(empty);
    expect(g.nodes).toEqual([
      expect.objectContaining({ id: 'start' }),
      expect.objectContaining({ id: 'end' }),
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: 'start', target: 'end' });
  });
});

describe('generateFlowchartHTML', () => {
  it('wraps the Mermaid diagram in a standalone HTML document', () => {
    const html = generateFlowchartHTML(sample);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('graph TD');
    expect(html).toContain('login flow');
  });
});
