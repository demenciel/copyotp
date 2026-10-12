// Geometry from Lucide v0.468.0 (ISC), vendored so the popup has no runtime
// dependency. See THIRD_PARTY_NOTICES.txt.
type Shape = [tag: string, attributes: Record<string, string>];

const shapes: Record<string, Shape[]> = {
  copy: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]
  ],
  mail: [
    ['rect', { width: '20', height: '16', x: '2', y: '4', rx: '2' }],
    ['path', { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' }]
  ],
  'shield-check': [
    ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
    ['path', { d: 'm9 12 2 2 4-4' }]
  ],
  'external-link': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]
  ],
  'refresh-cw': [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }]
  ],
  'log-out': [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['polyline', { points: '16 17 21 12 16 7' }],
    ['line', { x1: '21', x2: '9', y1: '12', y2: '12' }]
  ],
  inbox: [
    ['polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }],
    ['path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }]
  ],
  search: [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['path', { d: 'm21 21-4.3-4.3' }]
  ],
  timer: [
    ['line', { x1: '10', x2: '14', y1: '2', y2: '2' }],
    ['line', { x1: '12', x2: '15', y1: '14', y2: '11' }],
    ['circle', { cx: '12', cy: '14', r: '8' }]
  ],
  square: [['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]]
};

const svgAttributes = {
  xmlns: 'http://www.w3.org/2000/svg', width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
};

function svg(tag: string, attributes: Record<string, string>) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

// Replaces each <i data-lucide="name"> placeholder with its inline SVG.
export function createIcons(root: ParentNode = document) {
  for (const placeholder of root.querySelectorAll<HTMLElement>('[data-lucide]')) {
    const name = placeholder.dataset.lucide!;
    const children = shapes[name];
    if (!children) continue;
    const icon = svg('svg', { ...svgAttributes, class: `lucide lucide-${name}` });
    for (const attribute of placeholder.attributes) {
      if (attribute.name !== 'data-lucide' && attribute.name !== 'class') icon.setAttribute(attribute.name, attribute.value);
    }
    icon.append(...children.map(([tag, attributes]) => svg(tag, attributes)));
    placeholder.replaceWith(icon);
  }
}
