// The head-to-toe body map: one inline SVG, two independent channels per region.
//
//   FILL    = region level. A bottom-up "liquid" fill, clipped to a rect whose
//             height is how far into the current level the region's XP sits.
//             Hue runs HSL 220 (level 0, cold blue) -> 25 (level 10, ember).
//   OUTLINE = gear tier. iron / bronze / silver / gold, gold getting a halo.
//
// A third channel belongs to the heart alone: the ring around the head fills
// clockwise with this week's Zone-2 minutes, with a tick at the 150-minute line.
//
// Pure: no DOM, no state, no imports but ../util.js. Everything below is
// geometry plus arithmetic, so it is unit-testable and renders identically on
// both phones. No inline style attributes — SVG presentation attributes only,
// with CSS classes reserved for the token colours and the one animation.
import { raw, esc } from '../util.js';

// ---------------------------------------------------------------- palette
const TIER_STROKE = ['#6b7280', '#cd7f32', '#c0c0c0', '#ffd700'];   // iron bronze silver gold
const TIER_NAME = ['Iron', 'Bronze', 'Silver', 'Gold'];
const HUE_LOW = 220, HUE_HIGH = 25, HUE_LEVELS = 10;

/** Level -> fill hue. Cold blue at zero, ember at ten and above. */
export const regionHue = (level) =>
  HUE_LOW - ((HUE_LOW - HUE_HIGH) / HUE_LEVELS) * Math.min(HUE_LEVELS, Math.max(0, level));

/** How far into its current level a region sits, 0..1. thr[L] = divisor * L². */
export function fillFraction(xp, level, divisor = 40) {
  const floor = divisor * level * level;
  const next = divisor * (level + 1) * (level + 1);
  if (!(next > floor)) return 0;
  return Math.min(1, Math.max(0, (xp - floor) / (next - floor)));
}

// ---------------------------------------------------------------- mirroring
const n2 = (v) => (Math.round(v * 100) / 100).toString();

/**
 * Reflect a path about x = 120. Every path below uses only absolute M/L/C/Z, so
 * every number pair is an (x, y) and flipping x is the whole job. Paired regions
 * (arms, thighs, …) are therefore written once and drawn as one compound path.
 */
export function mirrorPath(d) {
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  let out = '';
  for (let i = 0; i < tok.length;) {
    const t = tok[i++];
    if (/[A-Z]/.test(t)) { out += t; continue; }
    out += `${n2(240 - Number(t))},${tok[i++]} `;
  }
  return out.trim();
}

// ---------------------------------------------------------------- anatomy
// viewBox is 240 x 520. The figure is centred on x = 120 and runs y 25 (crown)
// to y 495 (soles) — about 3.9 heights to widths, which is what a real body is.
// `half` paths are the viewer-right limb; the mirror supplies the other side.
const HEAD = 'M120,25C132,25 141,37 141,52C141,68 132,79 120,79C108,79 99,68 99,52C99,37 108,25 120,25Z';

const REGIONS = [
  // Drawn in this order, so the layering reads like a body: the back sits behind
  // everything, arms behind the pecs, deltoids capping both, the yoke on top.
  {
    id: 'back', label: 'Back', half: true,
    d: 'M144,138C156,143 164,156 164,174C164,196 159,216 152,234L140,228C146,212 151,192 151,172C151,158 148,146 144,138Z',
    y0: 138, y1: 234, nx: 158, ny: 197,
  },
  {
    id: 'arms', label: 'Arms', half: true,
    d: 'M158,150C169,153 178,159 182,167C188,184 190,204 188,222C186,246 183,270 182,292L167,292C168,268 170,244 170,222C170,200 164,170 158,150Z',
    y0: 150, y1: 292, nx: 180, ny: 238,
  },
  {
    id: 'chest', label: 'Chest',
    d: 'M89,114C102,106 138,106 151,114L153,142C148,158 135,166 120,166C105,166 92,158 87,142Z',
    y0: 106, y1: 166, nx: 105, ny: 148,
  },
  {
    id: 'shoulders', label: 'Shoulders', half: true,
    d: 'M150,108C166,111 180,120 184,134C186,146 184,157 181,164C171,159 160,153 150,147Z',
    y0: 108, y1: 164, nx: 172, ny: 139,
  },
  {
    id: 'neck_traps', label: 'Neck & traps',
    d: 'M108,72L132,72L132,90C144,94 154,101 161,110L153,120C143,112 132,108 120,107C108,108 97,112 87,120L79,110C86,101 96,94 108,90Z',
    y0: 72, y1: 120, nx: 98, ny: 113,
  },
  {
    id: 'core', label: 'Core',
    d: 'M91,164C104,171 136,171 149,164C147,182 144,198 142,212C141,222 141,232 142,242L98,242C99,232 99,222 98,212C96,198 93,182 91,164Z',
    y0: 164, y1: 242, nx: 120, ny: 206,
  },
  {
    id: 'glutes', label: 'Glutes & hips',
    d: 'M98,234L142,234C152,241 157,254 156,268C155,282 147,292 136,293C129,293 124,289 120,282C116,289 111,293 104,293C93,292 85,282 84,268C83,254 88,241 98,234Z',
    y0: 234, y1: 293, nx: 120, ny: 268,
  },
  {
    id: 'thighs', label: 'Thighs', half: true,
    d: 'M121,286L139,288C150,295 154,318 152,342C150,366 145,386 142,400L124,400C124,366 122,326 121,286Z',
    y0: 286, y1: 400, nx: 138, ny: 346,
  },
  {
    id: 'calves', label: 'Calves', half: true,
    d: 'M124,408L142,408C149,422 151,442 147,460C145,470 141,476 140,482L128,482C129,468 128,450 127,434C126,424 124,416 124,408Z',
    y0: 408, y1: 482, nx: 136, ny: 448,
  },
];

// Joints, hands and feet: never a region, only the statue holding itself together.
const FILLER = [
  'M127,480L141,480C143,488 149,492 152,494C154,496 153,499 150,499L126,499C124,499 124,496 125,493Z', // foot
  'M174,290C180,290 184,295 184,301C184,309 180,314 174,314C168,314 164,309 164,301C164,295 168,290 174,290Z', // hand
  'M133,396C141,396 148,401 148,407C148,413 141,417 133,417C126,417 120,413 120,407C120,401 126,396 133,396Z', // knee
];

// ---------------------------------------------------------------- helpers
const compound = (r) => (r.half ? `${r.d}${mirrorPath(r.d)}` : r.d);

/** Accepts either progress.gear ({slot:{tier,region}}) or a plain region->tier map. */
export function tiersByRegion(gear = {}) {
  const out = {};
  for (const [key, val] of Object.entries(gear)) {
    if (val && typeof val === 'object') {
      if (val.region == null) continue;
      out[val.region] = Math.max(out[val.region] ?? 0, val.tier ?? 0);
    } else {
      out[key] = Math.max(out[key] ?? 0, Number(val) || 0);
    }
  }
  return out;
}

const polar = (cx, cy, r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return [n2(cx + r * Math.cos(a)), n2(cy + r * Math.sin(a))];
};

// ---------------------------------------------------------------- the map
/**
 * @param {object}  o
 * @param {object}  o.regions  progress.regions: { id: { xp, level } }
 * @param {object}  o.gear     progress.gear, or { region: tier }
 * @param {object}  o.heart    { minutes, target = 150, tick = 150 } Zone-2, this week
 * @param {number}  o.divisor  region level divisor (gamification.region_level)
 * @param {string}  o.uid      id prefix, so two maps can share one page
 * @returns {{__html: string}} one inline <svg>
 */
export function silhouette({ regions = {}, gear = {}, heart = {}, divisor = 40, uid = 'wl' } = {}) {
  const tiers = tiersByRegion(gear);
  const clips = [];
  const shapes = [];
  const numbers = [];

  REGIONS.forEach((r, ri) => {
    const reg = regions[r.id] ?? { xp: 0, level: 0 };
    const level = Math.max(0, reg.level ?? 0);
    const frac = fillFraction(reg.xp ?? 0, level, divisor);
    const tier = tiers[r.id] ?? 0;
    const pid = `${uid}${ri}`;
    const span = r.y1 - r.y0;
    const top = n2(r.y1 - span * frac);

    clips.push(`<clipPath id="${pid}l"><rect x="0" y="${top}" width="240" height="${n2(span * frac)}"/></clipPath>`);
    if (frac > 0.02) clips.push(`<clipPath id="${pid}s"><rect x="0" y="${top}" width="240" height="2.4"/></clipPath>`);

    shapes.push(`<g data-region="${r.id}" class="wl-rg"><title>${esc(r.label)} — level ${level}, ${TIER_NAME[tier]} armour</title>`
      + `<use href="#${pid}" class="wl-body"/>`
      + (frac > 0 ? `<use href="#${pid}" fill="hsl(${n2(regionHue(level))} 70% 52%)" clip-path="url(#${pid}l)"/>` : '')
      + (frac > 0.02 ? `<use href="#${pid}" fill="#eaf2ff" opacity=".55" clip-path="url(#${pid}s)"/>` : '')
      + (tier === 3 ? `<use href="#${pid}" fill="none" stroke="${TIER_STROKE[3]}" stroke-width="5" opacity=".3"/>` : '')
      + `<use href="#${pid}" fill="none" stroke="${TIER_STROKE[tier]}" stroke-width="${tier ? 1.9 : 1.4}" stroke-linejoin="round"/>`
      + `</g>`);

    if (level > 0) {
      numbers.push(`<text x="${r.nx}" y="${r.ny}" class="wl-n" text-anchor="middle"`
        + ` font-size="12" font-weight="700" paint-order="stroke" stroke-width="3.4" stroke-linejoin="round">${level}</text>`);
    }
  });

  // ---- heart: head fills with heart level, ring around it with Zone-2 minutes
  const hReg = regions.heart ?? { xp: 0, level: 0 };
  const hLvl = Math.max(0, hReg.level ?? 0);
  const hFrac = fillFraction(hReg.xp ?? 0, hLvl, divisor);
  const hTier = tiers.heart ?? 0;
  const hTop = n2(79 - 54 * hFrac);

  const mins = Math.max(0, Math.round(heart.minutes ?? 0));
  const target = Math.max(1, heart.target ?? 150);
  const ringFrac = Math.min(1, mins / target);
  const R = 44, C = 2 * Math.PI * R;
  const tickFrac = Math.min(1, (heart.tick ?? 150) / target);
  const [tx1, ty1] = polar(120, 52, R - 7.5, tickFrac * 360);
  const [tx2, ty2] = polar(120, 52, R + 7.5, tickFrac * 360);

  clips.push(`<clipPath id="${uid}hl"><rect x="0" y="${hTop}" width="240" height="${n2(54 * hFrac)}"/></clipPath>`);
  if (hFrac > 0.02) clips.push(`<clipPath id="${uid}hs"><rect x="0" y="${hTop}" width="240" height="2.4"/></clipPath>`);

  const heartGroup = `<g data-region="heart" class="wl-rg">`
    + `<title>Heart — level ${hLvl}, ${TIER_NAME[hTier]} armour. ${mins} of ${target} Zone-2 minutes this week</title>`
    + `<circle cx="120" cy="52" r="${R}" fill="none" class="wl-track" stroke-width="5"/>`
    + (ringFrac > 0 ? `<circle cx="120" cy="52" r="${R}" fill="none" class="wl-ring" stroke-width="5" stroke-linecap="round"`
      + ` stroke-dasharray="${n2(C * ringFrac)} ${n2(C)}" transform="rotate(-90 120 52)"/>` : '')
    + `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" class="wl-tick" stroke-width="2" stroke-linecap="round"/>`
    + `<use href="#${uid}h" class="wl-body"/>`
    + (hFrac > 0 ? `<use href="#${uid}h" fill="hsl(${n2(regionHue(hLvl))} 70% 52%)" clip-path="url(#${uid}hl)"/>` : '')
    + (hFrac > 0.02 ? `<use href="#${uid}h" fill="#eaf2ff" opacity=".55" clip-path="url(#${uid}hs)"/>` : '')
    + (hTier === 3 ? `<use href="#${uid}h" fill="none" stroke="${TIER_STROKE[3]}" stroke-width="5" opacity=".3"/>` : '')
    + `<use href="#${uid}h" fill="none" stroke="${TIER_STROKE[hTier]}" stroke-width="${hTier ? 1.9 : 1.4}"/>`
    + `<path class="wl-pulse" d="M134,130C128,125 124,120 124,114C124,110 127,108 130,109C132,110 133,111 134,113C135,111 136,110 138,109C141,108 144,110 144,114C144,120 140,125 134,130Z"/>`
    + (hLvl > 0
      ? `<text x="120" y="57" class="wl-n" text-anchor="middle" font-size="15" font-weight="700"`
        + ` paint-order="stroke" stroke-width="3.6" stroke-linejoin="round">${hLvl}</text>`
      : '')
    + `</g>`;

  const defs = `<defs>`
    + `<path id="${uid}h" d="${HEAD}"/>`
    + REGIONS.map((r, i) => `<path id="${uid}${i}" d="${compound(r)}"/>`).join('')
    + clips.join('')
    + `</defs>`;

  const filler = FILLER.map(d => `<path class="wl-body wl-filler" d="${d}${mirrorPath(d)}"/>`).join('');

  return raw(`<svg class="wl-fig" viewBox="0 0 240 520" role="img" preserveAspectRatio="xMidYMid meet"`
    + ` aria-label="Body map: ten regions, filled by level and outlined by armour tier">`
    + defs
    + `<ellipse class="wl-ground" cx="120" cy="504" rx="64" ry="7"/>`
    + filler
    + shapes.join('')
    + heartGroup
    + numbers.join('')
    + `</svg>`);
}

export default silhouette;
