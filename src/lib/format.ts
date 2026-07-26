/** Display helpers shared by the listing page and the dashboard. */

/** 812 → "812", 12_400 → "12.4k", 3_100_000 → "3.1M". Token counts run large
 *  enough that the full number is noise, and small enough at the start that
 *  rounding everything to "0k" would look broken. */
export function compactTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) {
		const k = tokens / 1000;
		return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
	}
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** Wall time in the units a person would use: "48s", "2m 14s", "1h 3m". */
export function duration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
