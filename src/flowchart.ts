import type { Step, TestSuite } from './types.js';

export interface FlowNode {
  id: string;
  type: 'start' | 'end' | 'action';
  data: {
    label: string;
    stepId?: string;
    stepType?: Step['type'];
  };
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Generate a Mermaid.js flowchart representation of a test suite.
 */
export function generateMermaid(suite: TestSuite): string {
  const lines: string[] = ['graph TD'];
  
  // Start node
  lines.push(`  Start([Start: ${suite.baseUrl || 'URL'}])`);
  
  let prevNode = 'Start';
  
  suite.steps.forEach((step, index) => {
    const nodeId = `step_${index}`;
    const label = getStepLabel(step);
    const shape = getStepShape(step);
    
    lines.push(`  ${nodeId}${shape.open}${label}${shape.close}`);
    lines.push(`  ${prevNode} --> ${nodeId}`);
    
    prevNode = nodeId;
  });
  
  // End node
  lines.push(`  End([End])`);
  lines.push(`  ${prevNode} --> End`);
  
  return lines.join('\n');
}

// Mermaid-sensitive characters that break an unquoted node label:
// brackets/braces/parens delimit shapes, double quotes delimit quoted labels,
// semicolons terminate statements, pipes separate edge/label parts, and angle
// brackets can get interpreted as HTML. Replace all with a space.
const sanitizeMermaidLabel = (s: string): string =>
  s.replace(/[\[\]\(\)\{\}"<>|;`]/g, ' ');

function getStepLabel(step: Step): string {
  const type = step.type.charAt(0).toUpperCase() + step.type.slice(1);
  let detail = '';

  if (step.locator) {
    detail = `: ${step.locator.value}`;
  } else if (step.url) {
    detail = `: ${step.url}`;
  } else if (step.type === 'wait') {
    detail = `: ${step.timeoutMs}ms`;
  }

  let value = '';
  if (step.text) {
    value = ` ('${step.text}')`;
  } else if (step.selectValue) {
    value = ` ('${step.selectValue}')`;
  } else if (step.key) {
    value = ` [${step.key}]`;
  }

  return sanitizeMermaidLabel(`${type}${detail}${value}`);
}

function getStepShape(step: Step): { open: string; close: string } {
  switch (step.type) {
    case 'navigate':
      return { open: '[[', close: ']]' }; // Subroutine
    case 'click':
    case 'press':
    case 'fill':
    case 'select':
      return { open: '[', close: ']' }; // Process
    case 'assertText':
    case 'assertVisible':
      return { open: '{', close: '}' }; // Decision/Assertion
    case 'wait':
      return { open: '((', close: '))' }; // Event
    default:
      return { open: '[', close: ']' };
  }
}

/**
 * Generate a React Flow–compatible { nodes, edges } graph for the suite.
 * Nodes are laid out vertically with 100px spacing, starting with a Start node
 * and ending with an End node so the canvas always has clear entry/exit points.
 */
export function generateFlowNodes(suite: TestSuite): FlowGraph {
  const V_SPACING = 100;
  const X = 0;
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  nodes.push({
    id: 'start',
    type: 'start',
    data: { label: `Start: ${suite.name || 'Flow'}` },
    position: { x: X, y: 0 },
  });

  let prev = 'start';
  suite.steps.forEach((step, i) => {
    const id = step.id || `step_${i}`;
    nodes.push({
      id,
      type: 'action',
      data: { label: getStepLabel(step), stepId: step.id, stepType: step.type },
      position: { x: X, y: (i + 1) * V_SPACING },
    });
    edges.push({ id: `e_${prev}_${id}`, source: prev, target: id });
    prev = id;
  });

  nodes.push({
    id: 'end',
    type: 'end',
    data: { label: 'End' },
    position: { x: X, y: (suite.steps.length + 1) * V_SPACING },
  });
  edges.push({ id: `e_${prev}_end`, source: prev, target: 'end' });

  return { nodes, edges };
}

/**
 * Generate a simple HTML document containing the Mermaid flowchart.
 */
export function generateFlowchartHTML(suite: TestSuite): string {
  const mermaidCode = generateMermaid(suite);
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Flowchart: ${suite.name}</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true });
  </script>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 20px; }
    h1 { color: #333; }
    .mermaid { width: 100%; max-width: 1000px; }
    .controls { margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>Flowchart: ${suite.name}</h1>
  <div class="controls">
    <p>Created at: ${new Date(suite.createdAt).toLocaleString()}</p>
    <p>Base URL: ${suite.baseUrl || 'N/A'}</p>
  </div>
  <pre class="mermaid">
${mermaidCode}
  </pre>
</body>
</html>`;
}
