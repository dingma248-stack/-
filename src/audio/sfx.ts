import { Sig, noise, osc, env, ring } from './dsp';

/**
 * Procedural sound recipes. Each returns a mono signal; the engine bakes a
 * few randomised variants of each into AudioBuffers at boot.
 */

type Recipe = (sr: number, v: number) => Sig;
const R = Math.random;
const rr = (a: number, b: number) => a + Math.random() * (b - a);

function gunshot(sr: number, o: { crack: number; body: number; thump: [number, number]; thumpDecay: number; tail: number; drive: number; bright: number }) {
  const dur = o.tail + 0.3;
  const s = new Sig(sr, dur);
  // transient crack
  s.mix(noise(sr, 0.012).gain(env.exp(0.0025)).filter('hp', 1800), 0, o.crack);
  // body
  s.mix(noise(sr, 0.4).filter('lp', (t) => o.bright * Math.exp(-t * 18) + 500, 0.9).gain(env.exp(o.body, 0.0008)), 0, 1.1);
  // low thump with pitch drop
  const [f0, f1] = o.thump;
  s.mix(osc(sr, 0.6, (t) => f1 + (f0 - f1) * Math.exp(-t * 30), 'sine').gain(env.exp(o.thumpDecay, 0.001)), 0, 1.2);
  // rumbling tail / slap-back
  s.mix(noise(sr, o.tail, R, 'brown').filter('lp', 700).gain(env.exp(o.tail * 0.35, 0.01)), 0.01, 0.55);
  s.mix(noise(sr, o.tail * 0.6).filter('bp', 1400, 0.8).gain(env.exp(o.tail * 0.12, 0.02)), 0.06, 0.12);
  return s.drive(o.drive).normalize(0.95).fadeEdges(0.0005, 0.05);
}

function click(sr: number, f: number, dur = 0.03, amp = 1) {
  const s = noise(sr, dur).filter('bp', f, 3).gain(env.exp(dur * 0.2, 0.0003));
  s.mix(ring(sr, dur * 3, [[f * 1.3, 0.3, 0.012], [f * 2.1, 0.2, 0.008]]), 0, 0.4);
  return s.gain(amp);
}

function groan(sr: number, dur: number, f0: number, vowel: number[], rough: number) {
  const s = new Sig(sr, dur);
  const vib = rr(3, 6);
  const base = osc(sr, dur, (t) => f0 * (1 + 0.06 * Math.sin(t * vib * 6.28) + 0.04 * Math.sin(t * 1.3) - 0.15 * (t / dur)), 'saw');
  base.mix(noise(sr, dur).filter('lp', 1200), 0, rough);
  for (let i = 0; i < vowel.length; i++) {
    const f = new Sig(sr, dur);
    f.d.set(base.d);
    f.filter('bp', (t) => vowel[i] * (1 + 0.1 * Math.sin(t * 2 + i)), 6);
    s.mix(f, 0, 1 / (i + 1));
  }
  s.gain(env.adsr(dur * 0.25, dur * 0.2, 0.7, dur * 0.25, dur * 0.3));
  return s.drive(2.5).normalize(0.8).fadeEdges(0.01, 0.05);
}

function thud(sr: number, f: number, dur: number, noiseLp = 500) {
  const s = osc(sr, dur, (t) => f * (1 + Math.exp(-t * 40)), 'sine').gain(env.exp(dur * 0.3, 0.001));
  s.mix(noise(sr, dur).filter('lp', noiseLp).gain(env.exp(dur * 0.15, 0.001)), 0, 0.8);
  return s;
}

function footstep(sr: number, kind: string): Sig {
  const s = new Sig(sr, 0.45);
  switch (kind) {
    case 'concrete':
      s.mix(thud(sr, rr(70, 95), 0.12, 600), 0, 0.9);
      s.mix(noise(sr, 0.05).filter('hp', 2500).gain(env.exp(0.012)), 0.005, 0.25);
      s.mix(noise(sr, 0.06).filter('bp', rr(1200, 1800), 2).gain(env.exp(0.015)), 0.02, 0.15);
      break;
    case 'tile':
      s.mix(thud(sr, rr(90, 120), 0.08, 900), 0, 0.6);
      s.mix(noise(sr, 0.03).filter('bp', rr(2500, 3500), 3).gain(env.exp(0.006)), 0, 0.7);
      s.mix(ring(sr, 0.1, [[rr(3000, 4200), 0.15, 0.01]]), 0, 0.5);
      break;
    case 'water':
      s.mix(thud(sr, 70, 0.08, 400), 0, 0.4);
      s.mix(noise(sr, 0.3).filter('bp', (t) => 1500 + t * 3000, 1.2).gain(env.exp(0.07, 0.01)), 0, 0.9);
      for (let i = 0; i < 4; i++) s.mix(osc(sr, 0.04, (t) => rr(600, 1500) * (1 + t * 20), 'sine').gain(env.exp(0.01)), rr(0.02, 0.18), 0.2);
      break;
    case 'metal':
      s.mix(thud(sr, rr(80, 100), 0.1, 700), 0, 0.6);
      s.mix(ring(sr, 0.4, [[rr(380, 450), 0.4, 0.12], [rr(1050, 1200), 0.3, 0.07], [rr(2200, 2600), 0.2, 0.04], [rr(3900, 4300), 0.1, 0.03]]), 0, 0.5);
      break;
    case 'carpet':
      s.mix(thud(sr, rr(60, 80), 0.1, 280), 0, 0.8);
      s.mix(noise(sr, 0.08).filter('lp', 900).gain(env.exp(0.025)), 0, 0.3);
      break;
    case 'wood':
      s.mix(thud(sr, rr(85, 110), 0.12, 700), 0, 0.7);
      s.mix(noise(sr, 0.15).filter('bp', rr(200, 260), 6).gain(env.exp(0.04)), 0, 0.8);
      s.mix(noise(sr, 0.1).filter('bp', rr(600, 900), 4).gain(env.exp(0.02)), 0, 0.3);
      if (R() < 0.4) s.mix(noise(sr, 0.12).filter('bp', rr(900, 1300), 18).gain(env.ad(0.03, 0.08)), 0.03, 0.2);
      break;
    case 'flesh':
      s.mix(thud(sr, 60, 0.12, 300), 0, 0.7);
      s.mix(noise(sr, 0.2).filter('bp', (t) => 500 + Math.sin(t * 90) * 200, 3).gain(env.exp(0.06)), 0, 0.7);
      break;
  }
  return s.normalize(0.8).fadeEdges(0.001, 0.05);
}

export const RECIPES: Record<string, { variants: number; make: Recipe }> = {
  // ---------- weapons ----------
  pistol: { variants: 4, make: (sr) => gunshot(sr, { crack: 0.9, body: 0.045, thump: [180, 55], thumpDecay: 0.06, tail: 0.7, drive: 2.2, bright: 5200 }) },
  shotgun: { variants: 3, make: (sr) => gunshot(sr, { crack: 1, body: 0.09, thump: [130, 38], thumpDecay: 0.13, tail: 1.3, drive: 3, bright: 3800 }) },
  magnum: { variants: 3, make: (sr) => gunshot(sr, { crack: 1.3, body: 0.07, thump: [150, 40], thumpDecay: 0.12, tail: 1.6, drive: 3.4, bright: 6000 }) },
  launcher: {
    variants: 2,
    make: (sr) => {
      const s = osc(sr, 0.4, (t) => 60 + 180 * Math.exp(-t * 25), 'sine').gain(env.exp(0.08));
      s.mix(noise(sr, 0.3).filter('lp', 1500).gain(env.exp(0.04)), 0, 0.7);
      s.mix(click(sr, 2500, 0.03), 0, 0.4);
      return s.drive(1.5).normalize(0.9).fadeEdges();
    },
  },
  explosion: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 3);
      s.mix(noise(sr, 3, R, 'brown').filter('lp', (t) => 2400 * Math.exp(-t * 3) + 120).gain(env.exp(0.7, 0.003)), 0, 1.4);
      s.mix(osc(sr, 1.5, (t) => 32 + 60 * Math.exp(-t * 8), 'sine').gain(env.exp(0.4, 0.002)), 0, 1.2);
      s.mix(noise(sr, 0.05).gain(env.exp(0.01)), 0, 1);
      for (let i = 0; i < 30; i++) s.mix(noise(sr, 0.02).filter('hp', 2000).gain(env.exp(0.004)), rr(0.05, 1.6), rr(0.05, 0.2));
      return s.drive(2.5).normalize(0.95).fadeEdges(0.001, 0.3);
    },
  },
  dryfire: { variants: 2, make: (sr) => click(sr, 3200, 0.04, 1).normalize(0.5) },
  knifeSwing: {
    variants: 3,
    make: (sr) => noise(sr, 0.25).filter('bp', (t) => 700 + Math.sin((t / 0.25) * Math.PI) * 2600, 2.5).gain(env.adsr(0.06, 0.05, 0.6, 0.02, 0.1)).normalize(0.6).fadeEdges(),
  },
  knifeHit: {
    variants: 3,
    make: (sr) => {
      const s = thud(sr, 80, 0.15, 500);
      s.mix(noise(sr, 0.15).filter('bp', (t) => 700 - t * 1500, 4).gain(env.exp(0.05)), 0, 1);
      return s.normalize(0.85).fadeEdges();
    },
  },
  shell: { variants: 5, make: (sr) => ring(sr, 0.35, [[rr(3000, 3600), 0.5, 0.06], [rr(4500, 5200), 0.4, 0.04], [rr(6500, 7400), 0.3, 0.025], [rr(1800, 2100), 0.15, 0.05]]).mix(click(sr, 5000, 0.01), 0, 0.3).normalize(0.5).fadeEdges() },
  shellShotgun: { variants: 3, make: (sr) => thud(sr, 200, 0.08, 1500).mix(ring(sr, 0.12, [[rr(850, 1000), 0.4, 0.03], [rr(1500, 1700), 0.2, 0.02]]), 0, 0.6).normalize(0.5).fadeEdges() },
  magOut: { variants: 2, make: (sr) => click(sr, 1800, 0.05).mix(noise(sr, 0.08).filter('bp', 900, 2).gain(env.exp(0.02)), 0.01, 0.4).normalize(0.6) },
  magIn: { variants: 2, make: (sr) => click(sr, 2400, 0.04).mix(click(sr, 1500, 0.06), 0.04, 1).normalize(0.7) },
  slide: {
    variants: 2,
    make: (sr) => {
      const s = click(sr, 2000, 0.04);
      s.mix(noise(sr, 0.06).filter('bp', 3000, 1.5).gain(env.ad(0.03, 0.03)), 0.03, 0.3);
      s.mix(click(sr, 2800, 0.05), 0.09, 1.2);
      return s.normalize(0.75);
    },
  },
  shellInsert: { variants: 3, make: (sr) => click(sr, 1400, 0.05).mix(thud(sr, 180, 0.06, 1500), 0.01, 0.5).normalize(0.6) },
  pump: {
    variants: 2,
    make: (sr) => {
      const s = noise(sr, 0.1).filter('bp', 1800, 1.5).gain(env.ad(0.04, 0.05));
      s.mix(click(sr, 1600, 0.05), 0.08, 1.2);
      s.mix(noise(sr, 0.1).filter('bp', 2200, 1.5).gain(env.ad(0.04, 0.05)), 0.16, 0.6);
      s.mix(click(sr, 2100, 0.05), 0.24, 1.3);
      return s.normalize(0.8);
    },
  },
  revolverOpen: { variants: 1, make: (sr) => click(sr, 2200, 0.05).mix(ring(sr, 0.3, [[1800, 0.2, 0.08], [2700, 0.15, 0.05]]), 0.02, 1).normalize(0.6) },
  revolverClose: { variants: 1, make: (sr) => click(sr, 1700, 0.06).mix(ring(sr, 0.3, [[1200, 0.3, 0.06]]), 0, 0.8).normalize(0.7) },
  revolverEject: {
    variants: 1,
    make: (sr) => {
      const s = new Sig(sr, 0.6);
      for (let i = 0; i < 6; i++) s.mix(ring(sr, 0.25, [[rr(3000, 3800), 0.4, 0.05], [rr(5000, 6000), 0.3, 0.03]]), 0.05 + i * rr(0.03, 0.06), 0.6);
      return s.normalize(0.5);
    },
  },
  glOpen: { variants: 1, make: (sr) => click(sr, 900, 0.08).mix(thud(sr, 120, 0.1, 900), 0, 0.6).normalize(0.7) },
  glClose: { variants: 1, make: (sr) => thud(sr, 140, 0.12, 1200).mix(click(sr, 1100, 0.06), 0, 1).normalize(0.8) },
  grenadeBounce: { variants: 3, make: (sr) => thud(sr, 160, 0.1, 1200).mix(ring(sr, 0.2, [[rr(600, 750), 0.3, 0.04]]), 0, 0.5).normalize(0.6) },

  // ---------- impacts ----------
  impactConcrete: { variants: 4, make: (sr) => noise(sr, 0.12).filter('bp', rr(1500, 2600), 1.2).gain(env.exp(0.02)).mix(thud(sr, 120, 0.06, 1500), 0, 0.4).normalize(0.6).fadeEdges() },
  impactMetal: { variants: 4, make: (sr) => ring(sr, 0.5, [[rr(900, 1300), 0.4, 0.12], [rr(2300, 2900), 0.3, 0.08], [rr(4100, 4800), 0.2, 0.05]]).mix(click(sr, 4000, 0.02), 0, 0.8).normalize(0.6).fadeEdges() },
  impactWood: { variants: 3, make: (sr) => noise(sr, 0.12).filter('bp', rr(500, 800), 3).gain(env.exp(0.03)).mix(thud(sr, 110, 0.08, 900), 0, 0.6).normalize(0.6).fadeEdges() },
  impactFlesh: {
    variants: 4,
    make: (sr) => {
      const s = thud(sr, rr(60, 80), 0.12, 400);
      s.mix(noise(sr, 0.12).filter('bp', (t) => 900 - t * 4000, 3).gain(env.exp(0.03)), 0, 1.2);
      return s.normalize(0.8).fadeEdges();
    },
  },
  headshot: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 0.6);
      s.mix(noise(sr, 0.4).filter('bp', (t) => 1200 - t * 1800, 2).gain(env.exp(0.08)), 0, 1.2);
      for (let i = 0; i < 6; i++) s.mix(click(sr, rr(2000, 4500), 0.02), rr(0, 0.08), 0.5);
      s.mix(thud(sr, 55, 0.2, 300), 0, 0.9);
      s.mix(noise(sr, 0.3).filter('lp', 600).gain(env.exp(0.1)), 0.05, 0.6);
      return s.drive(1.6).normalize(0.9).fadeEdges();
    },
  },
  hitmarker: { variants: 1, make: (sr) => osc(sr, 0.05, 1900, 'tri').gain(env.exp(0.012)).normalize(0.35) },
  headmarker: { variants: 1, make: (sr) => osc(sr, 0.12, (t) => 2600 - t * 4000, 'tri').gain(env.exp(0.03)).normalize(0.4) },
  glass: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 1.2);
      s.mix(noise(sr, 0.15).filter('hp', 3000).gain(env.exp(0.03)), 0, 1);
      for (let i = 0; i < 40; i++) {
        const t = Math.pow(R(), 1.6) * 0.9;
        s.mix(ring(sr, 0.2, [[rr(2500, 8000), 0.5, rr(0.02, 0.06)], [rr(5000, 10000), 0.3, 0.02]]), t, rr(0.1, 0.4) * (1 - t));
      }
      return s.normalize(0.8).fadeEdges();
    },
  },
  bottle: {
    variants: 2,
    make: (sr) => {
      const s = noise(sr, 0.1).filter('hp', 2500).gain(env.exp(0.02));
      for (let i = 0; i < 14; i++) s.mix(ring(sr, 0.15, [[rr(2000, 6000), 0.5, 0.03]]), rr(0, 0.3), 0.3);
      return s.normalize(0.7);
    },
  },
  woodBreak: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 0.8);
      s.mix(noise(sr, 0.06).filter('bp', 1200, 1).gain(env.exp(0.012)), 0, 1.2);
      s.mix(thud(sr, 90, 0.25, 600), 0, 1);
      for (let i = 0; i < 10; i++) s.mix(noise(sr, 0.05).filter('bp', rr(400, 1500), 4).gain(env.exp(0.012)), rr(0.02, 0.5), rr(0.2, 0.6));
      return s.drive(1.5).normalize(0.85).fadeEdges();
    },
  },
  propHit: { variants: 4, make: (sr) => thud(sr, rr(90, 140), 0.15, 900).mix(ring(sr, 0.3, [[rr(500, 800), 0.25, 0.08], [rr(1400, 1900), 0.15, 0.05]]), 0, 0.6).normalize(0.6).fadeEdges() },
  bodyFall: { variants: 3, make: (sr) => thud(sr, rr(45, 60), 0.35, 350).mix(noise(sr, 0.2).filter('lp', 800).gain(env.exp(0.05)), 0.03, 0.5).normalize(0.85).fadeEdges() },

  // ---------- player ----------
  step_concrete: { variants: 6, make: (sr) => footstep(sr, 'concrete') },
  step_tile: { variants: 6, make: (sr) => footstep(sr, 'tile') },
  step_water: { variants: 5, make: (sr) => footstep(sr, 'water') },
  step_metal: { variants: 5, make: (sr) => footstep(sr, 'metal') },
  step_carpet: { variants: 5, make: (sr) => footstep(sr, 'carpet') },
  step_wood: { variants: 5, make: (sr) => footstep(sr, 'wood') },
  step_flesh: { variants: 4, make: (sr) => footstep(sr, 'flesh') },
  land: { variants: 2, make: (sr) => thud(sr, 55, 0.25, 500).mix(noise(sr, 0.1).filter('hp', 2000).gain(env.exp(0.02)), 0, 0.2).normalize(0.8) },
  breath: {
    variants: 1,
    make: (sr) => {
      const s = new Sig(sr, 2.4);
      const inh = noise(sr, 0.7, R, 'pink').filter('bp', 1300, 1.2).gain(env.adsr(0.25, 0.1, 0.8, 0.15, 0.2));
      const exh = noise(sr, 0.9, R, 'pink').filter('bp', 900, 1.4).gain(env.adsr(0.1, 0.2, 0.7, 0.3, 0.3));
      s.mix(inh, 0.05, 0.6).mix(exh, 0.9, 0.9);
      return s.normalize(0.5);
    },
  },
  heartbeat: {
    variants: 1,
    make: (sr) => {
      const s = new Sig(sr, 0.7);
      s.mix(osc(sr, 0.2, (t) => 48 + 20 * Math.exp(-t * 30), 'sine').gain(env.exp(0.05, 0.004)), 0, 1);
      s.mix(osc(sr, 0.2, (t) => 42 + 16 * Math.exp(-t * 30), 'sine').gain(env.exp(0.06, 0.004)), 0.24, 0.7);
      return s.filter('lp', 160).normalize(0.9);
    },
  },
  hurt: { variants: 3, make: (sr) => noise(sr, 0.3, R, 'pink').filter('bp', rr(500, 800), 2).gain(env.ad(0.02, 0.25)).mix(thud(sr, 70, 0.2, 300), 0, 0.7).normalize(0.7) },
  pickup: {
    variants: 1,
    make: (sr) => {
      const s = ring(sr, 0.5, [[880, 0.4, 0.15], [1320, 0.3, 0.12]]);
      s.mix(ring(sr, 0.5, [[1175, 0.4, 0.18], [1760, 0.25, 0.12]]), 0.07, 1);
      return s.normalize(0.45).fadeEdges();
    },
  },
  heal: { variants: 1, make: (sr) => noise(sr, 0.9).filter('bp', 4500, 1).gain(env.adsr(0.05, 0.2, 0.5, 0.3, 0.3)).mix(click(sr, 1500, 0.05), 0, 1).normalize(0.5) },
  battery: { variants: 1, make: (sr) => click(sr, 1700, 0.05).mix(click(sr, 2600, 0.04), 0.12, 1).normalize(0.6) },
  flashlight: { variants: 2, make: (sr) => click(sr, 2800, 0.03).mix(click(sr, 1600, 0.04), 0.03, 0.6).normalize(0.55) },
  save: {
    variants: 1,
    make: (sr) => {
      const s = new Sig(sr, 3);
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => s.mix(ring(sr, 2.6, [[f, 0.5, 0.9], [f * 2, 0.12, 0.4], [f * 3.01, 0.05, 0.2]]), i * 0.12, 0.6));
      return s.normalize(0.5).fadeEdges(0.002, 0.3);
    },
  },

  // ---------- enemies ----------
  groan: { variants: 6, make: (sr) => groan(sr, rr(1.2, 2.2), rr(70, 110), [rr(400, 650), rr(850, 1150), rr(2200, 2700)], 0.4) },
  growl: { variants: 4, make: (sr) => groan(sr, rr(0.6, 1), rr(60, 85), [rr(300, 450), rr(700, 900)], 0.7) },
  scream: { variants: 3, make: (sr) => groan(sr, rr(0.9, 1.4), rr(230, 330), [rr(700, 900), rr(1300, 1700), rr(2800, 3300)], 0.5) },
  zombieDeath: { variants: 3, make: (sr) => groan(sr, rr(1, 1.6), rr(55, 75), [rr(350, 500), rr(800, 1000)], 0.6) },
  bite: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 0.6);
      for (let i = 0; i < 4; i++) s.mix(noise(sr, 0.1).filter('bp', rr(600, 1400), 3).gain(env.exp(0.025)), i * rr(0.06, 0.12), 0.8);
      s.mix(thud(sr, 70, 0.2, 400), 0, 0.6);
      return s.drive(2).normalize(0.85);
    },
  },
  bark: {
    variants: 4,
    make: (sr) => {
      const s = osc(sr, 0.28, (t) => rr(380, 460) - t * 700, 'saw').filter('bp', 900, 1.5).gain(env.ad(0.01, 0.25));
      s.mix(noise(sr, 0.28).filter('bp', 1600, 1).gain(env.ad(0.01, 0.2)), 0, 0.4);
      return s.drive(3).normalize(0.8).fadeEdges();
    },
  },
  dogGrowl: { variants: 3, make: (sr) => osc(sr, 1.2, (t) => 85 + 6 * Math.sin(t * 30), 'saw').filter('bp', 500, 1.2).gain((t) => (0.6 + 0.4 * Math.sin(t * 190)) * env.adsr(0.1, 0.2, 0.8, 0.5, 0.3)(t)).drive(2).normalize(0.7).fadeEdges() },
  screech: {
    variants: 3,
    make: (sr) => {
      const s = osc(sr, 0.9, (t) => rr(900, 1200) * (1 + 0.15 * Math.sin(t * 60)) * (1 - t * 0.3), 'saw').filter('bp', 2200, 2);
      s.mix(noise(sr, 0.9).filter('hp', 3000), 0, 0.5);
      return s.gain(env.adsr(0.02, 0.2, 0.6, 0.3, 0.35)).drive(3).normalize(0.8).fadeEdges();
    },
  },
  hiss: { variants: 2, make: (sr) => noise(sr, 1.2).filter('hp', 3500).filter('bp', (t) => 5000 + Math.sin(t * 17) * 1500, 1).gain(env.adsr(0.15, 0.3, 0.6, 0.4, 0.3)).normalize(0.6).fadeEdges() },
  skitter: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 0.8);
      for (let i = 0; i < 14; i++) s.mix(click(sr, rr(1500, 3500), 0.02), rr(0, 0.7), rr(0.3, 0.8));
      return s.normalize(0.5);
    },
  },
  bossStep: {
    variants: 4,
    make: (sr) => {
      const s = osc(sr, 0.8, (t) => 38 + 30 * Math.exp(-t * 20), 'sine').gain(env.exp(0.2, 0.003));
      s.mix(noise(sr, 0.6, R, 'brown').filter('lp', 400).gain(env.exp(0.12)), 0, 1.2);
      s.mix(ring(sr, 0.3, [[rr(300, 380), 0.12, 0.08]]), 0.01, 0.6);
      return s.drive(1.8).normalize(0.95).fadeEdges();
    },
  },
  bossRoar: {
    variants: 2,
    make: (sr) => {
      const s = groan(sr, 2.6, rr(48, 58), [rr(300, 400), rr(650, 800), rr(1600, 2000)], 0.8);
      s.mix(groan(sr, 2.6, rr(96, 110), [rr(500, 700), rr(1100, 1400)], 0.6), 0, 0.5);
      s.mix(osc(sr, 2.6, 30, 'sine').gain(env.adsr(0.4, 0.5, 0.7, 0.8, 0.8)), 0, 0.5);
      return s.drive(3).normalize(0.95).fadeEdges(0.01, 0.2);
    },
  },
  bossImpact: {
    variants: 3,
    make: (sr) => {
      const s = new Sig(sr, 1.6);
      s.mix(thud(sr, 45, 0.6, 700), 0, 1.3);
      s.mix(noise(sr, 1.4, R, 'brown').filter('lp', 1200).gain(env.exp(0.3)), 0, 0.9);
      for (let i = 0; i < 20; i++) s.mix(noise(sr, 0.04).filter('bp', rr(500, 3000), 2).gain(env.exp(0.01)), rr(0.03, 1.1), rr(0.1, 0.4));
      return s.drive(2.2).normalize(0.95).fadeEdges();
    },
  },
  whoosh: { variants: 3, make: (sr) => noise(sr, 0.5).filter('bp', (t) => 300 + Math.sin((t / 0.5) * Math.PI) * 1200, 1.5).gain(env.adsr(0.15, 0.1, 0.7, 0.05, 0.2)).normalize(0.7).fadeEdges() },
  acid: { variants: 2, make: (sr) => noise(sr, 0.8).filter('bp', (t) => 1200 + Math.sin(t * 80) * 400, 2).gain(env.adsr(0.02, 0.1, 0.6, 0.3, 0.3)).mix(osc(sr, 0.8, (t) => 300 + Math.sin(t * 50) * 80, 'saw').filter('lp', 900).gain(env.exp(0.3)), 0, 0.4).normalize(0.7).fadeEdges() },
  squelch: { variants: 3, make: (sr) => noise(sr, 0.5).filter('bp', (t) => 400 + Math.sin(t * 40) * 250, 4).gain(env.adsr(0.03, 0.1, 0.6, 0.2, 0.15)).normalize(0.7).fadeEdges() },

  // ---------- world ----------
  doorOpen: {
    variants: 3,
    make: (sr) => {
      const dur = rr(0.8, 1.3);
      const s = new Sig(sr, dur);
      let ph = 0;
      const base = rr(25, 60);
      for (let i = 0; i < s.n; i++) {
        const t = i / sr;
        const rate = base * (1 + 0.8 * Math.sin(t * 3 + 1) + 0.3 * Math.sin(t * 11));
        ph += rate / sr;
        if (ph >= 1) {
          ph -= 1;
          s.d[i] = 1;
        }
      }
      const a = new Sig(sr, dur);
      a.d.set(s.d);
      s.filter('bp', rr(600, 900), 12);
      a.filter('bp', rr(1500, 2100), 10);
      s.mix(a, 0, 0.6).gain(env.adsr(0.1, 0.2, 0.8, dur * 0.4, dur * 0.25));
      s.mix(thud(sr, 90, 0.1, 600), 0, 0.15);
      return s.normalize(0.6).fadeEdges(0.01, 0.1);
    },
  },
  doorSlam: { variants: 2, make: (sr) => thud(sr, 65, 0.4, 900).mix(ring(sr, 0.5, [[rr(180, 240), 0.2, 0.15], [rr(700, 900), 0.1, 0.1]]), 0, 0.8).drive(1.5).normalize(0.9) },
  doorLocked: { variants: 2, make: (sr) => click(sr, 1200, 0.08).mix(thud(sr, 120, 0.1, 1000), 0.03, 0.7).mix(click(sr, 900, 0.08), 0.12, 0.8).normalize(0.6) },
  metalDoor: { variants: 2, make: (sr) => thud(sr, 50, 0.5, 600).mix(ring(sr, 1.5, [[rr(110, 140), 0.4, 0.5], [rr(330, 380), 0.25, 0.35], [rr(760, 820), 0.12, 0.25]]), 0, 0.8).normalize(0.9).fadeEdges() },
  pneumatic: { variants: 1, make: (sr) => noise(sr, 1.2).filter('lp', (t) => 4000 * Math.exp(-t * 2.5) + 200).gain(env.adsr(0.02, 0.3, 0.5, 0.4, 0.4)).mix(thud(sr, 60, 0.4, 600), 0.9, 0.8).normalize(0.7).fadeEdges() },
  lever: { variants: 1, make: (sr) => thud(sr, 90, 0.2, 1200).mix(ring(sr, 0.4, [[540, 0.3, 0.12], [1350, 0.2, 0.08]]), 0, 0.8).mix(click(sr, 1500, 0.06), 0.12, 0.8).normalize(0.8) },
  beep: { variants: 1, make: (sr) => osc(sr, 0.09, 1250, 'square').filter('lp', 3000).gain(env.ad(0.002, 0.08)).normalize(0.35) },
  beepOk: { variants: 1, make: (sr) => osc(sr, 0.1, 1100, 'square').mix(osc(sr, 0.14, 1650, 'square'), 0.11, 1).filter('lp', 3500).gain(env.exp(0.15)).normalize(0.35) },
  beepErr: { variants: 1, make: (sr) => osc(sr, 0.35, 180, 'square').filter('lp', 1200).gain(env.ad(0.005, 0.33)).normalize(0.4) },
  zap: {
    variants: 3,
    make: (sr) => {
      const s = osc(sr, 0.6, (t) => 55 + Math.sin(t * 300) * 10, 'saw');
      s.mix(noise(sr, 0.6).filter('hp', 2000), 0, 0.8);
      s.gain((t) => (Math.sin(t * 700) > 0 ? 1 : 0.3) * env.exp(0.2)(t));
      return s.drive(4).normalize(0.85).fadeEdges();
    },
  },
  distantBoom: { variants: 3, make: (sr) => noise(sr, 4, R, 'brown').filter('lp', 220).gain(env.exp(1.1, 0.06)).mix(osc(sr, 2, 34, 'sine').gain(env.exp(0.6, 0.05)), 0, 0.6).normalize(0.9).fadeEdges(0.01, 0.4) },
  thunder: { variants: 2, make: (sr) => noise(sr, 5, R, 'brown').filter('lp', (t) => 900 * Math.exp(-t) + 120).gain((t) => env.exp(1.6, 0.1)(t) * (0.6 + 0.4 * Math.sin(t * 7) * Math.sin(t * 2.3))).normalize(0.9).fadeEdges(0.05, 0.5) },
  drip: { variants: 3, make: (sr) => osc(sr, 0.12, (t) => rr(900, 1400) * (1 + t * 12), 'sine').gain(env.exp(0.02, 0.001)).normalize(0.35) },
  radio: {
    variants: 2,
    make: (sr) => {
      const s = noise(sr, 1).filter('bp', 1800, 0.8).gain((t) => 0.5 + 0.5 * Math.abs(Math.sin(t * 13)));
      for (let i = 0; i < 25; i++) s.mix(click(sr, rr(1000, 4000), 0.01), R(), 1);
      return s.normalize(0.4).fadeEdges(0.01, 0.1);
    },
  },
  bulb: { variants: 2, make: (sr) => noise(sr, 0.25).filter('hp', 2000).gain(env.exp(0.04)).mix(ring(sr, 0.4, [[rr(3000, 5000), 0.4, 0.05]]), 0, 1).normalize(0.5) },
  carAlarm: {
    variants: 1,
    make: (sr) => osc(sr, 2.4, (t) => (Math.floor(t * 5) % 2 ? 1100 : 820), 'square').filter('lp', 2500).gain((t) => 0.7 + 0.3 * Math.sin(t * 40)).normalize(0.5),
  },

  // ---------- stingers & UI ----------
  stingerHigh: {
    variants: 2,
    make: (sr) => {
      const s = new Sig(sr, 2.2);
      const base = rr(1100, 1400);
      for (const k of [1, 1.059, 1.122, 1.414, 0.94]) {
        s.mix(osc(sr, 2.2, (t) => base * k * (1 + 0.012 * Math.sin(t * 38 + k * 10)), 'saw').filter('bp', base * k * 1.5, 1.2), 0, 0.3);
      }
      s.gain((t) => (t < 0.03 ? t / 0.03 : Math.exp(-(t - 0.03) / 0.6)) * (0.7 + 0.3 * Math.sin(t * 70)));
      s.mix(noise(sr, 0.3).filter('hp', 3000).gain(env.exp(0.08)), 0, 0.5);
      return s.drive(2).normalize(0.9).fadeEdges(0.001, 0.2);
    },
  },
  stingerLow: {
    variants: 2,
    make: (sr) => {
      const s = new Sig(sr, 3.2);
      const swell = noise(sr, 0.7, R, 'pink').filter('bp', (t) => 300 + t * 3000, 1).gain(env.swell(0.7, 3));
      s.mix(swell, 0, 0.6);
      s.mix(osc(sr, 2.5, (t) => 30 + 50 * Math.exp(-t * 6), 'sine').gain(env.exp(0.8, 0.002)), 0.7, 1.4);
      s.mix(noise(sr, 2.5, R, 'brown').filter('lp', 300).gain(env.exp(0.6, 0.002)), 0.7, 1);
      s.mix(osc(sr, 2.4, 55 * 1.06, 'saw').filter('lp', 500).gain(env.exp(0.9, 0.01)), 0.7, 0.3);
      return s.drive(2).normalize(0.95).fadeEdges(0.01, 0.3);
    },
  },
  uiHover: { variants: 2, make: (sr) => osc(sr, 0.04, rr(2100, 2300), 'sine').gain(env.exp(0.008, 0.0005)).mix(noise(sr, 0.01).filter('hp', 5000).gain(env.exp(0.002)), 0, 0.3).normalize(0.18) },
  uiSelect: { variants: 1, make: (sr) => ring(sr, 1.4, [[392, 0.5, 0.4], [587.3, 0.3, 0.3], [784, 0.15, 0.2]]).mix(noise(sr, 0.02).filter('hp', 4000).gain(env.exp(0.004)), 0, 0.4).normalize(0.4).fadeEdges(0.001, 0.2) },
  uiBack: { variants: 1, make: (sr) => ring(sr, 0.8, [[311, 0.5, 0.25], [466, 0.25, 0.2]]).normalize(0.3).fadeEdges() },
  type: { variants: 4, make: (sr) => click(sr, rr(2500, 3500), 0.02, 1).normalize(0.12) },
  typeBell: { variants: 1, make: (sr) => ring(sr, 0.8, [[2093, 0.5, 0.25], [4186, 0.15, 0.1]]).normalize(0.18) },
  inventory: { variants: 1, make: (sr) => noise(sr, 0.3).filter('bp', 2400, 1.2).gain(env.ad(0.05, 0.22)).mix(click(sr, 1400, 0.04), 0.15, 0.6).normalize(0.35) },
  paper: { variants: 2, make: (sr) => noise(sr, 0.35).filter('bp', (t) => 3000 + Math.sin(t * 60) * 1500, 1).gain((t) => env.ad(0.03, 0.3)(t) * (0.5 + 0.5 * Math.abs(Math.sin(t * 45)))).normalize(0.35) },
};

/** Looping beds (baked once, longer buffers). */
export const LOOPS: Record<string, (sr: number) => Sig> = {
  rain: (sr) => {
    const dur = 6;
    const s = noise(sr, dur, R, 'pink').filter('hp', 600).filter('lp', 7000).gain(0.6);
    for (let i = 0; i < 900; i++) s.mix(noise(sr, 0.006).filter('bp', rr(2000, 7000), 2).gain(env.exp(0.0015)), R() * dur, rr(0.05, 0.3));
    return loopify(s, 0.4);
  },
  wind: (sr) => {
    const dur = 8;
    const s = noise(sr, dur, R, 'pink').filter('bp', (t) => 350 + 250 * Math.sin(t * 0.8) + 120 * Math.sin(t * 2.1), 1.6);
    return loopify(s.normalize(0.6), 1);
  },
  fire: (sr) => {
    const dur = 5;
    const s = noise(sr, dur, R, 'brown').filter('lp', 500).gain(0.6);
    for (let i = 0; i < 260; i++) s.mix(noise(sr, 0.008).filter('bp', rr(1500, 6000), 1).gain(env.exp(0.002)), R() * dur, rr(0.1, 0.6));
    return loopify(s.normalize(0.7), 0.4);
  },
  hum: (sr) => {
    const dur = 2;
    const s = osc(sr, dur, 100, 'saw').filter('lp', 900).gain(0.3);
    s.mix(osc(sr, dur, 120, 'sine'), 0, 0.3);
    s.mix(noise(sr, dur).filter('bp', 3500, 3), 0, 0.05);
    return s.normalize(0.4);
  },
  breath: (sr) => RECIPES.breath.make(sr, 0),
  heli: (sr) => {
    const dur = 2;
    const s = noise(sr, dur, R, 'brown').filter('lp', 600).gain((t) => 0.4 + 0.6 * Math.pow(Math.abs(Math.sin(t * Math.PI * 11)), 6));
    s.mix(osc(sr, dur, 44, 'saw').filter('lp', 200), 0, 0.4);
    s.mix(noise(sr, dur).filter('bp', 2400, 2).gain(0.1), 0, 1);
    return s.normalize(0.8);
  },
  alarm: (sr) => {
    const dur = 2;
    const s = osc(sr, dur, (t) => 520 + 300 * Math.abs(Math.sin(t * Math.PI)), 'square').filter('lp', 2200).gain((t) => (t % 1 < 0.7 ? 1 : 0.0));
    return s.normalize(0.45);
  },
  drone: (sr) => {
    const dur = 8;
    const s = osc(sr, dur, 55, 'saw').filter('lp', 160).gain(0.5);
    s.mix(noise(sr, dur, R, 'brown').filter('lp', 140), 0, 0.6);
    return loopify(s.normalize(0.7), 1);
  },
  pulse: (sr) => {
    const dur = 1.6;
    const s = new Sig(sr, dur);
    s.mix(osc(sr, 0.3, (t) => 45 + 15 * Math.exp(-t * 20), 'sine').gain(env.exp(0.08, 0.01)), 0, 1);
    s.mix(osc(sr, 0.3, (t) => 40 + 15 * Math.exp(-t * 20), 'sine').gain(env.exp(0.1, 0.01)), 0.32, 0.7);
    s.mix(noise(sr, dur, R, 'brown').filter('lp', 200), 0, 0.15);
    return s.normalize(0.7);
  },
  water: (sr) => {
    const dur = 6;
    const s = noise(sr, dur, R, 'pink').filter('bp', 900, 0.7).gain(0.4);
    for (let i = 0; i < 80; i++) s.mix(osc(sr, 0.05, (t) => rr(500, 1500) * (1 + t * 10), 'sine').gain(env.exp(0.012)), R() * dur, rr(0.05, 0.15));
    return loopify(s.normalize(0.5), 0.5);
  },
};

/** Cross-fade the tail into the head so the loop is seamless. */
function loopify(s: Sig, fade: number): Sig {
  const f = Math.floor(fade * s.sr);
  const out = new Sig(s.sr, s.dur - fade);
  for (let i = 0; i < out.n; i++) out.d[i] = s.d[i];
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out.d[i] = s.d[i] * k + s.d[out.n + i] * (1 - k);
  }
  return out;
}
