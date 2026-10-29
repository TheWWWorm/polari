import { Relation } from '../../core/models';

export interface GraphNode { id: string; x: number; y: number; degree: number; }

/** Deterministic force-directed layout (repulsion between all nodes, springs along edges). */
export function layoutGraph(edges: Relation[], iterations = 420): GraphNode[] {
  const ids = [...new Set(edges.flatMap((r) => [r.a, r.b]))];
  const degree = new Map<string, number>();
  for (const r of edges) { degree.set(r.a, (degree.get(r.a) ?? 0) + 1); degree.set(r.b, (degree.get(r.b) ?? 0) + 1); }
  ids.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0));
  const nodes = ids.map((id, i) => ({ id, x: Math.cos(i * 2.4) * (60 + i * 9), y: Math.sin(i * 2.4) * (60 + i * 9), vx: 0, vy: 0, degree: degree.get(id) ?? 0 }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2), f = 30000 / d2;
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const r of edges) {
      const a = at.get(r.a)!, b = at.get(r.b)!;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 150) * 0.012;
      a.vx += (dx / d) * f * d * 0.06; a.vy += (dy / d) * f * d * 0.06;
      b.vx -= (dx / d) * f * d * 0.06; b.vy -= (dy / d) * f * d * 0.06;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004; n.vy -= n.y * 0.004;
      n.x += Math.max(-30, Math.min(30, n.vx)) * cool;
      n.y += Math.max(-30, Math.min(30, n.vy)) * cool;
      n.vx *= 0.5; n.vy *= 0.5;
    }
  }
  return nodes.map(({ id, x, y, degree }) => ({ id, x, y, degree }));
}
