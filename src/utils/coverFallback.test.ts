import { describe, it, expect } from 'vitest';
import { artForId } from './coverFallback';

const TEMPLATES = ['bluenote', 'portrait', 'minimal', 'display', 'label', 'classic', 'split'];
const PALETTES = [
  'noir', 'bluenote', 'crimson', 'forest', 'plum', 'rust', 'teal',
  'cream', 'mono', 'electric', 'peach', 'gold', 'sky', 'ink',
];

describe('artForId', () => {
  it('is deterministic for a given id', () => {
    expect(artForId(305571)).toEqual(artForId(305571));
    expect(artForId(1)).toEqual(artForId(1));
  });

  it('only uses renderable templates and known palettes', () => {
    for (const id of [1, 2, 42, 249504, 800301, 990221, 123456789]) {
      const { tpl, pal } = artForId(id);
      expect(TEMPLATES).toContain(tpl);
      expect(PALETTES).toContain(pal);
    }
  });

  it('spreads across templates and palettes (not a constant)', () => {
    const tpls = new Set<string>();
    const pals = new Set<string>();
    for (let id = 1; id <= 400; id++) {
      const { tpl, pal } = artForId(id);
      tpls.add(tpl);
      pals.add(pal);
    }
    // Over 400 ids we expect every template and most palettes to appear.
    expect(tpls.size).toBe(TEMPLATES.length);
    expect(pals.size).toBeGreaterThanOrEqual(PALETTES.length - 2);
  });
});
