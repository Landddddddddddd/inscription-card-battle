// Procedural SVG card art v2 — rich, illustrated portraits.
// Each card gets: a faction-specific SCENE background (not just a color),
// a shaded, rim-lit creature body, and faction corner ornaments so the four
// decks look visibly different at a glance.
//
// cardArt(card) -> an <svg> string that fills the .portrait box (viewBox 0 0 100 100).

/* =============================== color helpers =============================== */
function parse(h) { h = (h || '#888888').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function clamp(x) { return Math.max(0, Math.min(255, Math.round(x))); }
function hx(n) { return clamp(n).toString(16).padStart(2, '0'); }
export function shade(hexc, f) {
  const [r, g, b] = parse(hexc);
  if (f >= 0) return '#' + hx(r + (255 - r) * f) + hx(g + (255 - g) * f) + hx(b + (255 - b) * f);
  const k = 1 + f; return '#' + hx(r * k) + hx(g * k) + hx(b * k);
}
function mix(a, b, t) { const A = parse(a), B = parse(b); return '#' + hx(A[0] + (B[0] - A[0]) * t) + hx(A[1] + (B[1] - A[1]) * t) + hx(A[2] + (B[2] - A[2]) * t); }
function seed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
function rng(s) { let x = s || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1000) / 1000; }; }

/* =============================== archetype map =============================== */
const MAP = {
  // BLOOD (beasts of the crimson woods)
  squirrel: { s: 'critter' }, stoat: { s: 'critter' }, raven: { s: 'bird' }, mole: { s: 'critter' },
  beaver: { s: 'critter' }, adder: { s: 'serpent' }, raccoon: { s: 'critter' }, opossum: { s: 'critter' },
  wolf: { s: 'beast' }, bullfrog: { s: 'frog' }, vulture: { s: 'bird' }, cougar: { s: 'beast' },
  dire_wolf: { s: 'beast' }, hound: { s: 'beast' }, skunk: { s: 'critter' }, great_white: { s: 'shark' },
  warthog: { s: 'beast' }, bear: { s: 'beast' }, wolf_cub: { s: 'critter' },
  // BONE (undead of the crypt)
  bone_pup: { s: 'skull' }, rat: { s: 'critter' }, cat: { s: 'critter' }, spider: { s: 'bug' },
  bat: { s: 'bird' }, skeleton: { s: 'skull' }, corpse: { s: 'skull' }, crab: { s: 'shell' },
  scorpion: { s: 'bug' }, zombie: { s: 'skull' }, black_widow: { s: 'bug' }, turtle: { s: 'shell' },
  bone_hound: { s: 'beast' }, geck: { s: 'serpent' },
  // ENERGY (machines of the lab)
  black_cat: { s: 'critter', mech: 1 }, magpie: { s: 'bird', mech: 1 }, fennec: { s: 'critter', mech: 1 },
  peacock: { s: 'bird', mech: 1 }, lynx: { s: 'beast', mech: 1 }, mantis: { s: 'bug', mech: 1 },
  falcon: { s: 'bird', mech: 1 }, ram: { s: 'beast', mech: 1 }, grey_jaguar: { s: 'beast', mech: 1 },
  eagle: { s: 'bird', mech: 1 }, bison: { s: 'beast', mech: 1 }, bull: { s: 'beast', mech: 1 },
  // MOX (crystal cavern dwellers)
  ruby_mox: { s: 'gem', gem: 1 }, emerald_mox: { s: 'gem', gem: 1 }, sapphire_mox: { s: 'gem', gem: 1 },
  imp: { s: 'demon', gem: 1 }, panther: { s: 'beast', gem: 1 }, python: { s: 'serpent', gem: 1 },
  demon: { s: 'demon', gem: 1 }, basilisk: { s: 'serpent', gem: 1 }, chimera: { s: 'demon', gem: 1 },
  golem: { s: 'golem', gem: 1 }, manticore: { s: 'beast', gem: 1 }, griffin: { s: 'bird', gem: 1 },
  phoenix: { s: 'bird', gem: 1, fire: 1 },
};
const FALLBACK = { blood: 'beast', bone: 'skull', energy: 'critter', gem: 'demon' };
function facOf(card) { return card.costType === 'gem' ? 'gem' : card.costType; }

/* =============================== faction scenes =============================== */
// Each returns a full-frame background <group> that establishes mood + place.
function sceneBlood(id, r) {
  const trees = [];
  for (let i = 0; i < 5; i++) { const x = 8 + i * 21 + r() * 6; const h = 30 + r() * 26; trees.push(`<path d="M${x},100 L${x - 6},${100 - h} L${x},${100 - h - 8} L${x + 6},${100 - h} Z" fill="#1c0708" opacity=".85"/>`); }
  return `
    <defs>
      <radialGradient id="sky${id}" cx="50%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#7a1f22"/><stop offset="45%" stop-color="#4a1114"/><stop offset="100%" stop-color="#180405"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#sky${id})"/>
    <circle cx="50" cy="30" r="17" fill="#c0392b" opacity=".35"/><circle cx="50" cy="30" r="11" fill="#e05a3a" opacity=".4"/>
    ${trees.join('')}
    <ellipse cx="50" cy="97" rx="46" ry="9" fill="#2a0a0b"/>
    <rect width="100" height="100" fill="url(#mist${id})"/>`;
}
function sceneBone(id, r) {
  const stones = [];
  for (let i = 0; i < 4; i++) { const x = 14 + i * 24 + r() * 4; const h = 16 + r() * 12; stones.push(`<rect x="${x - 5}" y="${92 - h}" width="10" height="${h}" rx="4" fill="#20262b"/><rect x="${x - 6}" y="${92 - h - 4}" width="12" height="6" rx="3" fill="#20262b"/>`); }
  return `
    <defs>
      <radialGradient id="sky${id}" cx="50%" cy="34%" r="80%">
        <stop offset="0%" stop-color="#3c4a4a"/><stop offset="45%" stop-color="#232d30"/><stop offset="100%" stop-color="#0c1214"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#sky${id})"/>
    <path d="M18,60 Q50,10 82,60" fill="none" stroke="#0c1214" stroke-width="10" opacity=".6"/>
    <path d="M26,62 Q50,24 74,62" fill="none" stroke="#3a4a4a" stroke-width="2" opacity=".5"/>
    <circle cx="50" cy="34" r="13" fill="#9fd7ff" opacity=".16"/>
    ${stones.join('')}
    <ellipse cx="50" cy="96" rx="46" ry="9" fill="#161d20"/>`;
}
function sceneEnergy(id, r) {
  const traces = [];
  for (let i = 0; i < 6; i++) { const y = 12 + i * 15; traces.push(`<path d="M0,${y} h${20 + r() * 30} v${8} h${20 + r() * 20}" fill="none" stroke="#0e3a44" stroke-width="1.4"/>`); }
  const nodes = [];
  for (let i = 0; i < 7; i++) nodes.push(`<circle cx="${10 + r() * 80}" cy="${10 + r() * 80}" r="1.5" fill="#39d6ff" opacity=".7"/>`);
  return `
    <defs>
      <linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0d2b33"/><stop offset="100%" stop-color="#04141a"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#sky${id})"/>
    <g opacity=".55">${traces.join('')}</g>
    ${nodes.join('')}
    <rect width="100" height="100" fill="none" stroke="#0a2027" stroke-width="2"/>`;
}
function sceneGem(id, r) {
  const shards = [];
  for (let i = 0; i < 5; i++) { const x = 6 + i * 22 + r() * 6; const h = 20 + r() * 30; const c = ['#e67e22', '#27ae60', '#2980b9', '#8e44ad'][Math.floor(r() * 4)]; shards.push(`<path d="M${x},100 L${x - 5},${100 - h * .6} L${x},${100 - h} L${x + 5},${100 - h * .6} Z" fill="${c}" opacity=".5"/>`); }
  return `
    <defs>
      <radialGradient id="sky${id}" cx="50%" cy="36%" r="82%">
        <stop offset="0%" stop-color="#3a2255"/><stop offset="50%" stop-color="#241338"/><stop offset="100%" stop-color="#0e0819"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#sky${id})"/>
    ${shards.join('')}
    <g fill="#fff" opacity=".8"><circle cx="24" cy="22" r="1"/><circle cx="70" cy="18" r="1.3"/><circle cx="84" cy="46" r=".9"/><circle cx="16" cy="52" r=".9"/></g>
    <ellipse cx="50" cy="97" rx="46" ry="8" fill="#1a1030"/>`;
}
const SCENE = { blood: sceneBlood, bone: sceneBone, energy: sceneEnergy, gem: sceneGem };

/* =============================== shared defs =============================== */
function bodyDefs(id, pal) {
  return `
    <defs>
      <linearGradient id="bd${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${pal.light}"/><stop offset="55%" stop-color="${pal.base}"/><stop offset="100%" stop-color="${pal.dark}"/>
      </linearGradient>
      <radialGradient id="vig${id}" cx="50%" cy="44%" r="64%">
        <stop offset="52%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="rgba(0,0,0,0.55)"/>
      </radialGradient>
      <linearGradient id="rim${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,.5)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
    </defs>`;
}
function vignette(id) { return `<rect width="100" height="100" fill="url(#vig${id})"/>`; }
function ground(pal) { return `<ellipse cx="50" cy="88" rx="30" ry="6" fill="rgba(0,0,0,0.35)"/>`; }
function dEye(x, y, r, glow) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="${glow || '#fff'}"/><circle cx="${x}" cy="${y}" r="${r * 0.48}" fill="#111"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .22}" fill="#fff" opacity=".8"/>`; }

/* =============================== creature drawers =============================== */
function beast(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <path d="M20,66 q-4,10 2,12 h4 q2,-6 -1,-12 z"/><path d="M74,66 q4,10 -2,12 h-4 q-2,-6 1,-12 z"/>
      <ellipse cx="47" cy="56" rx="27" ry="16"/>
      <path d="M28,64 q-3,9 3,11 h4 q2,-6 -1,-11 z"/><path d="M66,64 q3,9 -3,11 h-4 q-2,-6 1,-11 z"/>
      <path d="M70,52 q14,-3 16,-14 q1,8 -2,15 q6,4 5,12 q-9,4 -19,-2 z"/>
      <path d="M78,30 l6,-9 l1,10 z"/><path d="M85,31 l7,-7 l-1,10 z"/>
    </g>
    <path d="M24,48 q22,-10 44,0" stroke="url(#rim${id})" stroke-width="2.2" fill="none" opacity=".7"/>
    ${dEye(82, 40, 3, pal.eye)}
    <path d="M88,44 q4,1 5,4" stroke="${pal.dark}" stroke-width="1.4" fill="none"/>
    <path d="M18,58 q-6,2 -9,7 q7,0 11,-3 z" fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.3"/>`;
}
function critter(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <ellipse cx="50" cy="62" rx="22" ry="20"/><circle cx="50" cy="40" r="16"/>
      <path d="M38,30 q-5,-12 2,-14 q4,3 4,12 z"/><path d="M62,30 q5,-12 -2,-14 q-4,3 -4,12 z"/>
      <path d="M70,66 q12,4 10,14 q-8,-1 -13,-8 z"/>
    </g>
    <path d="M40,32 q10,-6 20,0" stroke="url(#rim${id})" stroke-width="2" fill="none" opacity=".7"/>
    ${dEye(43, 40, 3.1, pal.eye)}${dEye(57, 40, 3.1, pal.eye)}
    <path d="M50,45 l-3,4 h6 z" fill="${pal.dark}"/>`;
}
function bird(id, pal, fire) {
  const wing = fire ? '#ff8a2a' : ('url(#bd' + id + ')');
  return `
    <g stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <path d="M50,52 q-30,-20 -42,-6 q16,4 24,12 q-14,0 -20,8 q18,4 34,-2 z" fill="${wing}"/>
      <path d="M50,52 q30,-20 42,-6 q-16,4 -24,12 q14,0 20,8 q-18,4 -34,-2 z" fill="${wing}"/>
      <ellipse cx="50" cy="56" rx="11" ry="18" fill="url(#bd${id})"/>
      <circle cx="50" cy="34" r="9" fill="url(#bd${id})"/>
      <path d="M50,30 l-11,-3 l9,7 z" fill="${fire ? '#ffd15a' : pal.eye}"/>
    </g>
    <path d="M44,50 q6,-4 12,0" stroke="url(#rim${id})" stroke-width="1.6" fill="none" opacity=".6"/>
    ${dEye(48, 33, 2.6, '#fff')}
    ${fire ? '<path d="M50,74 q-6,10 0,18 q6,-8 0,-18z" fill="#ff5a1a" opacity=".85"/><path d="M40,70 q-4,7 1,12 q3,-6 -1,-12z" fill="#ffb03a" opacity=".7"/>' : ''}`;
}
function serpent(id, pal) {
  return `
    <g fill="none" stroke="${pal.dark}" stroke-width="15" stroke-linecap="round" opacity=".4"><path d="M22,82 q10,-18 30,-14 q22,4 22,-14 q0,-14 -14,-16"/></g>
    <g fill="none" stroke="url(#bd${id})" stroke-width="12.5" stroke-linecap="round"><path d="M22,82 q10,-18 30,-14 q22,4 22,-14 q0,-14 -14,-16"/></g>
    <g fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2.5" stroke-linecap="round"><path d="M24,80 q10,-16 28,-13"/></g>
    <circle cx="60" cy="24" r="9.5" fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5"/>
    ${dEye(63, 22, 2.4, pal.eye)}
    <path d="M60,15 l-2,-8 l3,4 l2,-4 l-1,8z" fill="#c0392b"/>`;
}
function bug(id, pal) {
  const legs = [];
  for (let i = 0; i < 4; i++) { const y = 44 + i * 8; legs.push(`<path d="M40,${y} q-16,-4 -22,6"/><path d="M60,${y} q16,-4 22,6"/>`); }
  return `
    <g stroke="${pal.dark}" stroke-width="2.4" fill="none" stroke-linecap="round">${legs.join('')}</g>
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5">
      <ellipse cx="50" cy="60" rx="17" ry="20"/><circle cx="50" cy="36" r="12"/>
      <path d="M44,26 q-3,-10 -8,-12 M56,26 q3,-10 8,-12" stroke="${pal.dark}" stroke-width="2" fill="none"/>
    </g>
    <path d="M42,52 q8,-4 16,0" stroke="url(#rim${id})" stroke-width="1.6" fill="none" opacity=".6"/>
    ${dEye(45, 35, 3, pal.eye)}${dEye(55, 35, 3, pal.eye)}`;
}
function skull(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <path d="M30,42 q0,-24 20,-24 q20,0 20,24 q0,12 -6,17 l1,10 q-15,6 -30,0 l1,-10 q-6,-5 -6,-17z"/>
    </g>
    <circle cx="41" cy="44" r="6.5" fill="#0a0a0a"/><circle cx="59" cy="44" r="6.5" fill="#0a0a0a"/>
    <circle cx="41" cy="44" r="2.6" fill="${pal.eye}"/><circle cx="59" cy="44" r="2.6" fill="${pal.eye}"/>
    <path d="M50,52 l-3,7 h6 z" fill="#0a0a0a"/>
    <g stroke="${pal.dark}" stroke-width="1.3"><path d="M42,72 v8 M50,73 v8 M58,72 v8"/></g>
    <path d="M34,32 q16,-8 32,0" stroke="url(#rim${id})" stroke-width="2" fill="none" opacity=".6"/>`;
}
function shell(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <ellipse cx="34" cy="60" rx="9" ry="6"/><ellipse cx="66" cy="60" rx="9" ry="6"/>
      <circle cx="72" cy="46" r="8"/><path d="M22,58 a28,20 0 0 1 56,0 z"/>
    </g>
    <g fill="none" stroke="${pal.dark}" stroke-width="1.4" opacity=".7"><path d="M50,38 v20 M32,46 l6,12 M68,46 l-6,12 M28,54 h44"/></g>
    <path d="M28,50 a22,14 0 0 1 44,0" stroke="url(#rim${id})" stroke-width="2" fill="none" opacity=".5"/>
    ${dEye(74, 44, 2.4, pal.eye)}`;
}
function frog(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <ellipse cx="50" cy="62" rx="26" ry="18"/>
      <path d="M26,70 q-10,2 -12,10 q8,1 14,-4z"/><path d="M74,70 q10,2 12,10 q-8,1 -14,-4z"/>
      <circle cx="40" cy="44" r="9"/><circle cx="60" cy="44" r="9"/>
    </g>
    ${dEye(40, 43, 3.4, pal.eye)}${dEye(60, 43, 3.4, pal.eye)}
    <path d="M36,64 q14,8 28,0" stroke="${pal.dark}" stroke-width="1.6" fill="none"/>`;
}
function shark(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <path d="M14,58 q22,-22 60,-14 q14,3 16,8 q-10,4 -18,3 q6,6 4,14 q-10,-2 -14,-8 q-24,8 -48,-3 z"/>
      <path d="M46,34 l6,-16 l6,18 z"/>
    </g>
    <path d="M20,52 q26,-14 54,-8" stroke="url(#rim${id})" stroke-width="2" fill="none" opacity=".5"/>
    ${dEye(74, 50, 2.6, pal.eye)}
    <path d="M60,58 l6,3 l-6,2 l5,3 l-6,1" stroke="#fff" stroke-width="1.1" fill="none"/>`;
}
function demon(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.5" stroke-linejoin="round">
      <path d="M30,60 q0,-26 20,-26 q20,0 20,26 q0,10 -6,16 h-28 q-6,-6 -6,-16z"/>
      <path d="M30,44 l-8,-16 q10,4 12,14z"/><path d="M70,44 l8,-16 q-10,4 -12,14z"/>
      <path d="M34,76 q16,8 32,0 l-4,10 q-12,5 -24,0z"/>
    </g>
    <path d="M40,48 l8,3 l-8,3z" fill="${pal.eye}"/><path d="M60,48 l-8,3 l8,3z" fill="${pal.eye}"/>
    <g stroke="#fff" stroke-width="1.2"><path d="M42,66 l4,4 l4,-4 l4,4 l4,-4"/></g>
    <path d="M36,40 q14,-8 28,0" stroke="url(#rim${id})" stroke-width="2" fill="none" opacity=".55"/>`;
}
function golem(id, pal) {
  return `
    <g fill="url(#bd${id})" stroke="${pal.dark}" stroke-width="1.6" stroke-linejoin="round">
      <rect x="30" y="34" width="40" height="36" rx="6"/>
      <rect x="22" y="44" width="10" height="24" rx="4"/><rect x="68" y="44" width="10" height="24" rx="4"/>
      <rect x="34" y="70" width="12" height="14" rx="3"/><rect x="54" y="70" width="12" height="14" rx="3"/>
    </g>
    <rect x="40" y="44" width="8" height="8" rx="2" fill="${pal.eye}"/><rect x="52" y="44" width="8" height="8" rx="2" fill="${pal.eye}"/>
    <path d="M38,60 h24" stroke="${pal.dark}" stroke-width="2"/>
    <path d="M32,37 h36" stroke="url(#rim${id})" stroke-width="2" opacity=".5"/>`;
}
function gem(id, pal, col) {
  const c = col || pal.base;
  return `
    <defs><linearGradient id="gm${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${shade(c, .6)}"/><stop offset="50%" stop-color="${c}"/><stop offset="100%" stop-color="${shade(c, -.45)}"/>
    </linearGradient></defs>
    <g stroke="${shade(c, -.5)}" stroke-width="1.4" stroke-linejoin="round">
      <path d="M50,14 L76,40 L50,88 L24,40 Z" fill="url(#gm${id})"/>
      <path d="M50,14 L76,40 L50,50 Z" fill="${shade(c, .5)}" opacity=".95"/>
      <path d="M24,40 L50,50 L50,88 Z" fill="${shade(c, -.22)}"/>
      <path d="M24,40 L50,14 L50,50 Z" fill="${shade(c, .28)}"/>
    </g>
    <path d="M38,28 l5,8 l-8,-3z" fill="#fff" opacity=".9"/>
    <circle cx="66" cy="24" r="2.4" fill="#fff"/><circle cx="30" cy="60" r="1.7" fill="#fff"/>`;
}
const DRAW = { beast, critter, bird, serpent, bug, skull, shell, frog, shark, demon, golem, gem };

/* =============================== faction overlays / frame =============================== */
function overlayBlood() { return `<g opacity=".85"><path d="M6,8 q6,3 8,9 M12,6 q4,4 5,9 M18,6 q3,4 3,8" stroke="#e05a3a" stroke-width="1.4" fill="none" opacity=".7"/><path d="M50,0 q-2,6 1,10 q3,-4 -1,-10z" fill="#c0392b" opacity=".6"/></g>`; }
function overlayBone() { return `<g stroke="#cfe8f2" stroke-width="1.2" opacity=".6" fill="none"><path d="M4,14 q6,-3 6,-9 M96,14 q-6,-3 -6,-9"/></g><g fill="#dfeef4" opacity=".7"><circle cx="8" cy="8" r="1.5"/><circle cx="92" cy="8" r="1.5"/></g>`; }
function overlayEnergy() { return `<g opacity=".95"><circle cx="22" cy="22" r="9" fill="rgba(6,18,24,.6)" stroke="#39d6ff" stroke-width="1.3"/><path d="M23,15 l-6,10 h5 l-2,8 l7,-11 h-5 z" fill="#eafcff" stroke="#39d6ff" stroke-width=".6"/></g><g stroke="#39d6ff" stroke-width="1" opacity=".5"><path d="M0,50 h10 M90,50 h10"/></g>`; }
function overlayGem() { return `<g fill="#fff" opacity=".95"><path d="M78,18 l1.8,4.4 l4.4,1.8 l-4.4,1.8 l-1.8,4.4 l-1.8,-4.4 l-4.4,-1.8 l4.4,-1.8z"/></g><g fill="#fff" opacity=".7"><circle cx="20" cy="70" r="1.2"/><circle cx="86" cy="64" r="1"/></g>`; }
const OVERLAY = { blood: overlayBlood, bone: overlayBone, energy: overlayEnergy, gem: overlayGem };

/* =============================== palette =============================== */
function palette(card) {
  const base = card.color || '#888';
  const eyeByFac = { blood: '#ff5a3c', bone: '#9fd7ff', energy: '#7fe3ff', gem: '#ffe27a' };
  const fac = facOf(card);
  return { base, light: shade(base, .45), mid: shade(base, .12), dark: shade(base, -.5), eye: eyeByFac[fac] || '#fff' };
}

/* =============================== public API =============================== */
export function cardArt(card) {
  if (!card) return '';
  const fac = facOf(card);
  const conf = MAP[card.cardId] || { s: FALLBACK[fac] || 'critter' };
  const s = seed(card.cardId || 'x');
  const r = rng(s);
  const id = (card.cardId || 'c') + '_' + (s % 9999);
  const pal = palette(card);
  const drawer = DRAW[conf.s] || critter;

  let body;
  if (conf.s === 'gem') {
    const gemCol = { orange: '#e67e22', green: '#27ae60', blue: '#2980b9' }[card.mox] || pal.base;
    body = drawer(id, pal, gemCol);
  } else {
    body = drawer(id, pal, conf.fire ? 1 : 0);
  }

  const scene = (SCENE[fac] || sceneBlood)(id, rng(s ^ 0x9e3779b9));
  const overlay = (OVERLAY[fac] || overlayBlood)();

  return `<svg class="cardart" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${bodyDefs(id, pal)}
    ${scene}
    ${ground(pal)}
    ${body}
    ${overlay}
    ${vignette(id)}
  </svg>`;
}
