import { Action, Game, Piece, STATS, Side, dist } from './engine';

/** What a piece is worth on the board: a wounded one is half spent. */
const worth = (p: Piece) => STATS[p.kind].value * (p.hurt ? 0.5 : 1);

/** Material and position from one side's point of view. */
function score(g: Game, me: Side): number {
  if (g.over) return g.winner === me ? 1e6 : g.winner ? -1e6 : 0;
  let s = 0;
  const enemySparks = g.pieces.filter((p) => p.side !== me && p.kind === 'iskra');
  const mySparks = g.pieces.filter((p) => p.side === me && p.kind === 'iskra');
  for (const p of g.pieces) {
    const sign = p.side === me ? 1 : -1;
    s += sign * worth(p) * 10;
    if (p.kind === 'podkova' || p.kind === 'mech') {
      // attackers want to close in on the enemy sparks
      const foes = p.side === me ? enemySparks : mySparks;
      const near = Math.min(...foes.map((f) => dist(p, f)), 20);
      s += sign * (22 - near) * (p.kind === 'podkova' ? 1.2 : 0.6);
    }
    // a piece standing next to enemy fighters may be struck down on their turn; the unarmoured and the wounded fall at once
    const foes = g.pieces.filter((q) => q.side !== p.side && q.kind !== 'moneta' && dist(q, p) === 1).length;
    if (foes) s -= sign * worth(p) * 10 * (STATS[p.kind].armour && !p.hurt ? 0.15 : 0.45) * (p.side === me ? 1 : 0.3);
    // keeping close to the spark keeps the стратема whole
    if (p.kind !== 'iskra' && p.kind !== 'serp' && (p.side === me ? mySparks : enemySparks).some((sp) => dist(sp, p) === 1)) s += sign * 2;
  }
  // a spark within reach of enemy fighters is in danger
  for (const sp of g.pieces.filter((p) => p.kind === 'iskra')) {
    const sign = sp.side === me ? -1 : 1;
    const threats = g.pieces.filter((q) => q.side !== sp.side && q.kind !== 'moneta' && q.kind !== 'serp'
      && dist(q, sp) <= STATS[q.kind].speed + 1).length;
    const guards = g.pieces.filter((q) => q.side === sp.side && q.id !== sp.id && dist(q, sp) === 1).length;
    s += sign * Math.max(0, threats - guards) * 40;
  }
  // a coin already offered to a horseshoe is half the bargain
  s += g.pledges.filter((x) => g.byId(x.coin)?.side === me).length * 20;
  return s;
}

/** Choose the turn's touches one by one, each the best for the position it leaves. */
export function chooseTurn(game: Game, jitter = 3): Action[] {
  const me = game.side;
  const g = game.clone();
  const plan: Action[] = [];
  for (let k = 0; k < g.perTurn && g.side === me && !g.over; k++) {
    let best: { a: Action; v: number } | null = null;
    for (const p of g.pieces.filter((x: Piece) => x.side === me)) {
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

/** The computer agrees to a draw only when it is not ahead. */
export function acceptsDraw(game: Game): boolean { return score(game, game.side === 'red' ? 'blue' : 'red') <= 20; }
