// Static per-card "value efficiency" analyzer. Not a simulator — it estimates
// how much board value a card delivers per unit of its resource cost, including
// a rough sigil-value model. Surfaces cards that are clearly over- or under-
// statted relative to their cost tier, to guide targeted balance edits.
import { CARDS, FACTIONS } from './public/js/constants.js';

// Rough "bonus stats" a sigil is worth (heuristic, for triage only).
const SIGIL_VAL = {
  airborne: 1.5, double_strike: 0, // double_strike handled via *2 atk below
  poison_touch: 1.0, sharp_quills: 0.6, undying: 2.0, loose_tail: 0.3,
  pack: 1.0, brittle: -1.0, death_touch: 3.0, armored: 2.0,
  frenzy: 1.0, regen: 1.0,
};
function sigilBonus(c) {
  let v = 0;
  for (const s of c.sigils) v += (SIGIL_VAL[s] || 0);
  if (c.sigils.includes('double_strike')) v += c.atk; // deals 2x in combat
  return v;
}
// Resource cost proxy:
//  blood/bone/energy -> numeric cost
//  mox (gem) -> gemCost.length mapped to an investment (need that many colors
//    of generator on board). 1 gem ~ 1.5, 2 ~ 2.5, 3 ~ 3.5.
function costProxy(c) {
  if (c.costType === 'gem') {
    const n = (c.gemCost || []).length;
    return n <= 0 ? 0.5 : n + 0.5; // generators (gemCost []) ~ 0.5 (free body)
  }
  return c.cost || 0;
}
function eff(c) {
  const cp = costProxy(c);
  if (cp <= 0) {
    // free card: efficiency = raw stats + sigil (lower bar, but 0-cost bodies
    // are still a board presence). We report stats/1 so free cards are comparable.
    return (c.atk + c.hp + sigilBonus(c)) / 1;
  }
  return (c.atk + c.hp + sigilBonus(c)) / cp;
}

const rows = [];
for (const id of Object.keys(CARDS)) {
  const c = CARDS[id];
  rows.push({ id, faction: factionOf(id), name: c.name, cost: c.cost,
    costType: c.costType, gem: (c.gemCost || []).length, atk: c.atk,
    hp: c.hp, sigils: c.sigils.join(','), eff: +eff(c).toFixed(2),
    cp: +costProxy(c).toFixed(2) });
}
function factionOf(id) {
  for (const f of Object.keys(FACTIONS)) if (FACTIONS[f].cards.includes(id)) return f;
  return '?';
}

for (const f of ['blood', 'bone', 'energy', 'mox']) {
  const fr = rows.filter((r) => r.faction === f).sort((a, b) => b.eff - a.eff);
  const avg = fr.reduce((s, r) => s + r.eff, 0) / fr.length;
  console.log(`\n===== ${f} (avg eff ${avg.toFixed(2)}) =====`);
  console.log('id'.padEnd(13), 'name'.padEnd(7), 'ct'.padEnd(5), 'cost', 'gem', 'a/h', 'sigils'.padEnd(26), 'eff');
  for (const r of fr) {
    const flag = r.eff > avg * 1.35 ? '  <-- HIGH' : (r.eff < avg * 0.7 ? '  <-- LOW' : '');
    console.log(
      r.id.padEnd(13), r.name.padEnd(7), r.costType.padEnd(5),
      String(r.cost).padEnd(4), String(r.gem).padEnd(3),
      `${r.atk}/${r.hp}`.padEnd(5), r.sigils.padEnd(26), String(r.eff).padEnd(6), flag);
  }
}
