/**
 * Themes are client-only: the choice lives in localStorage and is applied as a
 * `data-theme` attribute on <html>. An inline script in `app.html` sets it
 * before first paint, so there is no flash of the default theme on load.
 */

export const THEME_STORAGE_KEY = 'fleabook:theme';

export type ThemeId = 'facebook' | 'midnight' | 'paper' | 'win98';

export const DEFAULT_THEME: ThemeId = 'facebook';

export const THEMES: { id: ThemeId; name: string; blurb: string }[] = [
	{
		id: 'facebook',
		name: 'Facebook',
		blurb: 'The blue-and-grey original. Where the listings end up.',
	},
	{
		id: 'midnight',
		name: 'Midnight',
		blurb: 'The dark neutral this app shipped with.',
	},
	{ id: 'paper', name: 'Paper', blurb: 'Warm, high-contrast light theme.' },
	{
		id: 'win98',
		name: 'Windows 98',
		blurb: 'Grey bevels, navy title bars, teal desktop.',
	},
];

export function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((t) => t.id === value);
}

export function readTheme(): ThemeId {
	if (typeof localStorage === 'undefined') return DEFAULT_THEME;
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	return isThemeId(stored) ? stored : DEFAULT_THEME;
}

export function applyTheme(theme: ThemeId) {
	document.documentElement.dataset.theme = theme;
	localStorage.setItem(THEME_STORAGE_KEY, theme);
}
