import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES, DEFAULT_THEME, isValidTheme } from './themes';

// Parse the shipped stylesheet directly so a theme that's registered but missing
// a `[data-theme]` block (or a variable) fails the build instead of the TV.
// Strip comments first so the header's example selectors aren't parsed as blocks.
const css = readFileSync(join(process.cwd(), 'css/themes.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const REQUIRED_VARS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-card',
  '--text-primary', '--text-secondary', '--text-muted',
  '--accent', '--accent-dim', '--accent-rgb', '--accent-glow',
  '--danger', '--danger-rgb', '--success',
  '--warning', '--warning-rgb', '--border',
];

function themeBlock(id: string): string | null {
  // Theme blocks contain no nested braces, so [^}]* captures the whole body.
  const m = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : null;
}

describe('theme registry', () => {
  it('has unique ids and a valid default', () => {
    const ids = THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isValidTheme(DEFAULT_THEME)).toBe(true);
  });

  it('defines a themes.css block with every required variable for each theme', () => {
    for (const t of THEMES) {
      const block = themeBlock(t.id);
      expect(block, `missing [data-theme="${t.id}"] block in themes.css`).not.toBeNull();
      for (const v of REQUIRED_VARS) {
        expect(block!.includes(`${v}:`), `theme ${t.id} missing ${v}`).toBe(true);
      }
    }
  });

  it('has no themes.css block without a matching registry entry', () => {
    const declared = Array.from(css.matchAll(/\[data-theme="([^"]+)"\]/g)).map(m => m[1]);
    for (const id of new Set(declared)) {
      expect(isValidTheme(id), `themes.css declares unregistered theme "${id}"`).toBe(true);
    }
  });
});
