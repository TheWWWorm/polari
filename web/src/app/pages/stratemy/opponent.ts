import { Action, Game, Piece, STATS, Side, dist } from './engine';

/** Material and position from one side's point of view. */
function score(g: Game, me: Side): number {
  if (g.winner) return g.winner === me ? 1e6 : -1e6;
  let s = 0;
  const enemySparks = g.pieces.filter((p) => p.side !== me && p.kind === 'iskra');
  const mySparks = g.pieces.filter((p) => p.side === me && p.kind === 'iskra');
  for (const p of g.pieces) {
    const sign = p.side === me ? 1 : -1;
    s += sign * STATS[p.kind].value * 10;
    if (p.kind === 'podkova' || p.kind === 'mech') {
      // attackers want to close in on the enemy sparks
      const foes = p.side === me ? enemySparks : mySparks;
      const near = Math.min(...foes.map((f) => dist(p, f)), 20);
      s += sign * (14 - near) * (p.kind === 'podkova' ? 1.2 : 0.6);
    }
    s += sign * g.defenceValue(p) * 0.4;
  }
  // a spark within reach of enemy horsemen is in danger
  for (const sp of g.pieces.filter((p) => p.kind === 'iskra')) {
    const sign = sp.side === me ? -1 : 1;
    const threats = g.pieces.filter((q) => q.side !== sp.side && q.kind !== 'moneta' && q.kind !== 'serp'
      && dist(q, sp) <= (q.kind === 'podkova' ? 4 : 2)).length;
    const guards = g.pieces.filter((q) => q.side === sp.side && q.id !== sp.id && dist(q, sp) === 1).length;
    s += sign * Math.max(0, threats - guards) * 40;
  }
  return s;
}

/** Choose the turn's actions one by one, each the best for the position it leaves. */
export function chooseTurn(game: Game, jitter = 3): Action[] {
  const me = game.side;
  const g = game.clone();
  const plan: Action[] = [];
  for (let k = 0; k < 3 && g.side === me && !g.winner; k++) {
    let best: { a: Action; v: number } | null = null;
    for (const p of g.pieces.filter((x: Piece) => x.side === me && !g.used.has(x.id))) {
      for (const a of g.actionsFor(p)) {
        const h = g.clone();
        h.apply(a);
        const v = score(h, me) + Math.random() * jitter;
        if (!best || v > best.v) best = { a, v };
      }
    }
    if (!best || best.v < score(g, me) - 1) break; // nothing improves the position: stand firm
    plan.push(best.a);
    g.apply(best.a);
  }
  return plan;
}
