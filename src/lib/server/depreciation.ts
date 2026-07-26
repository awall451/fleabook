/**
 * Depreciation reference for the pricing agent.
 *
 * These are passed into the prompt rather than applied in code. The agent needs
 * to reason about them — a cast-iron pan and a laptop do not depreciate on the
 * same curve, and the agent has to explain which curve it used in its rationale.
 * Keeping the numbers visible in the prompt also means the rationale it writes
 * can be checked against them.
 *
 * They are only a fallback. When real used-market comparables exist, those win:
 * a curve is a guess about the market, comps are the market.
 */

/** Fraction of original retail price retained by an item in "Used - Good" condition. */
export const RETENTION: Record<string, number> = {
	electronics: 0.32,
	small_appliance: 0.45,
	power_tools: 0.55,
	hand_tools: 0.8,
	furniture_flatpack: 0.25,
	furniture_solid: 0.6,
	cast_iron: 0.85,
	kitchenware: 0.45,
	kids_gear: 0.35,
	exercise: 0.35,
	default: 0.4
};

/** Applied on top of the retention rate, which is calibrated to "Used - Good". */
export const CONDITION_MULTIPLIER: Record<string, number> = {
	New: 1.35,
	'Used - Like New': 1.15,
	'Used - Good': 1.0,
	'Used - Fair': 0.75
};

/**
 * Facebook Marketplace clears below eBay for the same item: local cash pickup,
 * no shipping, no buyer protection, and a buyer who drove out expecting a deal.
 */
export const FB_LOCAL_DISCOUNT = 0.875;

/**
 * Fraction of current retail retained by unused goods whose box has been opened.
 *
 * The used-goods curve above does not apply to these and using it is a large,
 * one-directional error: `power_tools` retention (0.55) even at the "New"
 * multiplier (1.35) prices an unused, never-run tool at 74% of retail, as if
 * ownership itself consumed a quarter of its value. It did not — the only thing
 * that happened to this item is that a box was opened, and the buyer is getting
 * exactly what the store sells, minus the receipt and the warranty paperwork.
 *
 * So the "New" path prices off retail directly with this haircut instead of
 * running the depreciation chain. Tune this number, not the curve above, if
 * open-box listings read wrong.
 */
export const OPEN_BOX_RETENTION = 0.9;

export function retentionFor(depreciationKey: string): number {
	return RETENTION[depreciationKey] ?? RETENTION.default;
}

export function conditionMultiplierFor(condition: string | null): number {
	return (condition && CONDITION_MULTIPLIER[condition]) || 1.0;
}
