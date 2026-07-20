import { DEFAULT_THEME, DEFAULT_OVERLAY, isValidTheme, isValidOverlayStyle } from '../config/themes';
import { StorageService } from './storage-service';

// Theme switching is a single attribute write on <html>; the CSS variable
// overrides live in css/themes.css keyed by `[data-theme="<id>"]`. No runtime
// color math (keeps us within the Chromium-68 target).

function setThemeAttr(id: string | null | undefined): void {
  document.documentElement.dataset.theme = isValidTheme(id) ? id : DEFAULT_THEME;
}

/** Persisted theme applied to the document root. */
export function applyTheme(id: string): void {
  setThemeAttr(id);
}

/** Temporary preview (no persistence) — used by the Settings picker while the
 *  D-pad moves across swatches. */
export function previewTheme(id: string): void {
  setThemeAttr(id);
}

/** Player overlay glass style → `data-overlay` on the document root; the light
 *  variants live in css/player.css. */
export function applyOverlayStyle(style: string): void {
  document.documentElement.dataset.overlay = isValidOverlayStyle(style) ? style : DEFAULT_OVERLAY;
}

/** Re-assert the stored theme + overlay style on boot (belt-and-suspenders
 *  alongside the inline <head> script that beats the first paint). */
export function initTheme(): void {
  applyTheme(StorageService.getTheme());
  applyOverlayStyle(StorageService.getOverlayStyle());
}
