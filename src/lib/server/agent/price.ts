import { z } from 'zod';
import type { Listing } from '$lib/types';
import { depreciationKeyFor } from '../categories';
import {
	conditionMultiplierFor,
	FB_LOCAL_DISCOUNT,
	OPEN_BOX_RETENTION,
	retentionFor
} from '../depreciation';
import { listingPhotoDir } from '../images';
import { runStructured } from './run';

const PriceSchema = z
	.object({
		suggested: z.number().positive(),
		price_low: z.number().positive(),
		price_high: z.number().positive(),
		basis: z.enum(['comps', 'msrp', 'seller']),
		msrp: z.number().positive().nullable(),
		// Itemization for a bundle. Optional because most listings are one thing,
		// where the single `msrp` says everything a breakdown would.
		components: z
			.array(z.object({ name: z.string().min(1), retail: z.number().positive() }))
			.max(24)
			.default([]),
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

Read the seller's notes before you search. If they have already named the price they intend to ask, or told you not to research one, the decision is made and yours is not wanted: return their number with "basis": "seller", an empty "sources", and no searches at all. The seller knows things you do not — what they paid, what a neighbour sold one for, how fast they need it gone — and researching past them spends their money and several minutes of their time on an answer they did not ask for. Do this even when your own estimate would differ; say so in one sentence of the rationale if it would, and leave the number alone.

Unused goods are a different job, and treating them like secondhand ones is the most expensive mistake you can make here. An item whose box was opened but whose contents were never used has not depreciated — nothing happened to it except the loss of a receipt and a warranty card. Do not hunt for used comparables for these; a used listing of the same model is a different product. Price them off what the same goods cost new today, less a modest open-box haircut. Spend the search budget establishing current retail, not scouring the secondhand market for a match that does not exist.

A bundle is priced by itemizing it, never by eyeballing it. Look at every photograph and name every distinct item, then find current retail for each and add them up. Lumping the tail into one guess — "wire and accessories ~$15" — is where these go wrong, because the tail is routinely half the value: a heavy-gauge extension cord, a spool of wire, and a pair of gloves can each be worth more than the guess covering all three. If you cannot find a price for something, estimate it and say so, but give it a line of its own. An itemized total the seller can check beats a confident single number they cannot.

Weigh evidence honestly:
- Real used comparables beat any depreciation formula, for genuinely used goods. A formula is a guess about the market; comparables are the market.
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

0. If a price the seller intends to ask can be resolved from their notes — stated outright, or given as a rule against a figure in the photographs ("half what I paid") — stop here: return that number as "suggested", "price_low", and "price_high" alike, with "basis": "seller" and "sources": []. Skip every step below. If they waved the research off but left no number you can resolve, they have asked for one anyway by reaching this stage: price it normally.
1. Take stock of what is actually being sold. If the photographs and description show several distinct items, list them — every one, down to the consumables. Fill "components" with a line per item, and let that list drive everything below.
2. Establish CURRENT RETAIL for each item: what it costs to buy new today, from the manufacturer or a mainstream retailer. Set "msrp" to the total across every item, not the price of the headline one. For a bundle that total is the number the seller most needs; reporting the flagship item's price alone understates a kit by more than any other error you can make.
${
	listing.condition === 'New'
		? `3. This item is listed as New, so stop there — do not search for used comparables and do not run the depreciation curve. Set "basis" to "msrp" and price from the retail total:
     retail total
       x ${OPEN_BOX_RETENTION}   (open-box haircut: unused goods, opened packaging, no receipt or warranty)
   Never-used goods do not carry a used item's depreciation. If a note or a photograph shows one part of the bundle genuinely was used, deduct for that part specifically and say which, rather than marking the whole lot down.`
		: `3. Search for USED comparables — this same item, or the closest equivalent, listed secondhand. Note the prices you find and whether each is an asking price or a completed sale. If you found at least three you trust, set "basis" to "comps" and build the range from them.
4. Otherwise set "basis" to "msrp" and estimate from the retail total using this reference:
     retail total
       x ${retention}   (typical retention for ${listing.category ?? 'this category'} in Used - Good condition)
       x ${multiplier}   (adjustment for "${listing.condition ?? 'unknown'}")`
}
5. Either way, multiply the result by ${FB_LOCAL_DISCOUNT} for Facebook Marketplace: local cash pickup, no shipping, no buyer protection, and a buyer who came out expecting a deal.
6. Widen the range if the evidence was thin, and lower "confidence" to match. Confidence describes the evidence, not the arithmetic: a retail total you verified item by item is high confidence even though no comparable was involved.

Return:

\`\`\`json
{
  "suggested": 85,
  "price_low": 70,
  "price_high": 100,
  "basis": "comps",
  "msrp": 199,
  "components": [
    { "name": "each distinct item in the listing, named as a buyer would recognise it", "retail": 150 },
    { "name": "keep going — the small stuff is where the value hides", "retail": 22 }
  ],
  "rationale": "2-4 sentences: what you found, which comparables you used or why you fell back to retail, and how you landed on the number. Name the actual prices you saw.",
  "sources": ["https://... urls you actually opened"],
  "confidence": "high | medium | low"
}
\`\`\`

All prices are whole US dollars. "suggested" must sit between "price_low" and "price_high". Set "msrp" to null if you could not find a retail price. Only list URLs you actually visited.

Leave "components" as an empty array when the listing is a single item — the one "msrp" figure already says everything a breakdown would. Fill it whenever there is more than one thing in the box, and make the retail figures sum to "msrp".`;
}

export async function priceListing(
	listing: Listing,
	onProgress?: (note: string) => void
): Promise<PriceResult> {
	return runStructured(PriceSchema, {
		listingId: listing.id,
		stage: 'price',
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

/**
 * The patch for a listing the seller has already priced themselves, applied
 * *instead of* running this stage. No agent call happens, so there is no
 * research to record — every research field is cleared rather than left holding
 * numbers from an earlier run that the seller has now overridden.
 *
 * A null price is the "skip, but I named no number" case: the seller asked for
 * no research and gets none, and the price field stays empty for them to fill.
 * Guessing one here would be the exact behaviour they declined.
 */
export function sellerPricePatch(sellerPrice: number | null) {
	const cents = sellerPrice != null ? Math.round(sellerPrice * 100) : null;
	return {
		price_cents: cents,
		ai_price_low: null,
		ai_price_high: null,
		ai_price_basis: 'seller',
		ai_msrp_cents: null,
		ai_components: [],
		ai_rationale:
			cents != null
				? 'You set this price in the context box, so no price research was run.'
				: 'You asked to skip price research, so none was run. Set the price yourself.',
		ai_sources: [],
		ai_price_confidence: null,
		status: 'draft',
		error: null
	};
}

export function pricePatch(result: PriceResult) {
	return {
		price_cents: Math.round(result.suggested * 100),
		ai_price_low: Math.round(result.price_low * 100),
		ai_price_high: Math.round(result.price_high * 100),
		ai_price_basis: result.basis,
		ai_msrp_cents: result.msrp != null ? Math.round(result.msrp * 100) : null,
		ai_components: result.components.map((c) => ({
			name: c.name,
			retail_cents: Math.round(c.retail * 100)
		})),
		ai_rationale: result.rationale,
		ai_sources: result.sources,
		ai_price_confidence: result.confidence,
		status: 'draft',
		error: null
	};
}
