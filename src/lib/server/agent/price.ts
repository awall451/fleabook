import { z } from 'zod';
import type { Listing } from '$lib/types';
import { depreciationKeyFor } from '../categories';
import { conditionMultiplierFor, FB_LOCAL_DISCOUNT, retentionFor } from '../depreciation';
import { listingPhotoDir } from '../images';
import { runStructured } from './run';

const PriceSchema = z
	.object({
		suggested: z.number().positive(),
		price_low: z.number().positive(),
		price_high: z.number().positive(),
		basis: z.enum(['comps', 'msrp']),
		msrp: z.number().positive().nullable(),
		rationale: z.string().min(1),
		sources: z.array(z.string()).max(12),
		confidence: z.enum(['high', 'medium', 'low'])
	})
	.refine((v) => v.price_low <= v.suggested && v.suggested <= v.price_high, {
		message: 'suggested must fall between price_low and price_high'
	});

export type PriceResult = z.infer<typeof PriceSchema>;

const SYSTEM_PROMPT = `You price used household goods for a private seller posting on Facebook Marketplace.

Your job is to find what the item actually sells for secondhand, not what it costs new. Search the open web for real listings of the same item in similar condition.

Weigh evidence honestly:
- Real used comparables beat any depreciation formula. A formula is a guess about the market; comparables are the market.
- Web search reaches ASKING prices far more easily than SOLD prices, and asking prices run high — sellers start optimistic and negotiate down. Adjust for that gap rather than treating an asking price as a sale.
- Ignore listings for a different model, a different capacity, or obviously different condition. Two comparables you trust are worth more than eight you do not.

Work to a budget: at most 6 web searches and 5 page fetches. Stop as soon as you have three comparables you trust — a tighter estimate is not worth another five minutes of the seller's time. If the budget runs out before the evidence is solid, return what you have with a wider range and lower confidence. That is a valid answer; an exhaustive search is not a better one.

State your uncertainty plainly. A seller who knows the range is soft will price to test the market; one given a false precise number will sit unsold for a month.

Always reply with exactly one \`\`\`json fenced code block and no other text.`;

function sellerNotesBlock(userContext: string | null | undefined): string {
	const notes = (userContext ?? '').trim();
	if (!notes) return '';
	// The seller's notes can carry price-relevant facts the photos don't: a
	// sealed unit worth more, a defect worth less, a purchase link that dates it.
	return `  Seller notes: ${notes}\n`;
}

function buildPrompt(listing: Listing): string {
	const retention = retentionFor(depreciationKeyFor(listing.category));
	const multiplier = conditionMultiplierFor(listing.condition);

	return `Price this item.

  Brand:      ${listing.ai_brand ?? 'unknown'}
  Model:      ${listing.ai_model ?? 'unknown'}
  Title:      ${listing.title ?? '(none)'}
  Category:   ${listing.category ?? 'unknown'}
  Condition:  ${listing.condition ?? 'unknown'}
  Known flaws: ${listing.ai_flaws.length > 0 ? listing.ai_flaws.join('; ') : 'none noted'}
${sellerNotesBlock(listing.user_context)}
Photographs of the actual item are in your working directory if you need to check its condition.

Work in this order:

1. Search for USED comparables — this same item, or the closest equivalent, listed secondhand. Note the prices you find and whether each is an asking price or a completed sale.
2. Search for the ORIGINAL retail price or MSRP, as an anchor for step 4.
3. If you found at least three comparables you trust, set "basis" to "comps" and build the range from them.
4. Otherwise set "basis" to "msrp" and estimate from retail using this reference:
     retail price
       x ${retention}   (typical retention for ${listing.category ?? 'this category'} in Used - Good condition)
       x ${multiplier}   (adjustment for "${listing.condition ?? 'unknown'}")
5. Either way, multiply the result by ${FB_LOCAL_DISCOUNT} for Facebook Marketplace: local cash pickup, no shipping, no buyer protection, and a buyer who came out expecting a deal.
6. Widen the range if the evidence was thin, and lower "confidence" to match.

Return:

\`\`\`json
{
  "suggested": 85,
  "price_low": 70,
  "price_high": 100,
  "basis": "comps",
  "msrp": 199,
  "rationale": "2-4 sentences: what you found, which comparables you used or why you fell back to retail, and how you landed on the number. Name the actual prices you saw.",
  "sources": ["https://... urls you actually opened"],
  "confidence": "high | medium | low"
}
\`\`\`

All prices are whole US dollars. "suggested" must sit between "price_low" and "price_high". Set "msrp" to null if you could not find a retail price. Only list URLs you actually visited.`;
}

export async function priceListing(
	listing: Listing,
	onProgress?: (note: string) => void
): Promise<PriceResult> {
	return runStructured(PriceSchema, {
		prompt: buildPrompt(listing),
		systemPrompt: SYSTEM_PROMPT,
		model: 'claude-opus-4-8',
		allowedTools: ['WebSearch', 'WebFetch', 'Read'],
		disallowedTools: ['Bash', 'Write', 'Edit', 'Agent'],
		cwd: listingPhotoDir(listing.id),
		// Hard ceiling behind the prompt's search budget. Unbounded, this stage
		// will happily research for five minutes; the marginal comparable is not
		// worth the wait.
		maxTurns: 16,
		onProgress
	});
}

export function pricePatch(result: PriceResult) {
	return {
		price_cents: Math.round(result.suggested * 100),
		ai_price_low: Math.round(result.price_low * 100),
		ai_price_high: Math.round(result.price_high * 100),
		ai_price_basis: result.basis,
		ai_msrp_cents: result.msrp != null ? Math.round(result.msrp * 100) : null,
		ai_rationale: result.rationale,
		ai_sources: result.sources,
		ai_price_confidence: result.confidence,
		status: 'draft',
		error: null
	};
}
