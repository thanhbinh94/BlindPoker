/**
 * Theme entry point. The stylesheet itself ships separately:
 * `import '@bp/ui-kit/theme.css'` (tokens + global reset) in the host app.
 */
export type ThemeMode = 'dark' | 'light'

export const THEME_MODES: readonly ThemeMode[] = ['dark', 'light']

/** Sets `data-theme` on the given root; every token is defined for both modes. */
export function applyTheme(root: HTMLElement, mode: ThemeMode): void {
  root.dataset.theme = mode
}
