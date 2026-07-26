import { z } from 'zod';
import { readdir } from 'node:fs/promises';
import { CATEGORY_NAMES } from '../categories';
import { listingPhotoDir } from '../images';
import { runStructured } from './run';
import { CONDITIONS, LIMITS } from '$lib/types';

const IdentifySchema = z.object({
	brand: z.string().nullable(),
	model: z.string().nullable(),
	category: z.enum(CATEGORY_NAMES as [string, ...string[]]),
	condition: z.enum(CONDITIONS),
	condition_reason: z.string(),
	flaws: z.array(z.string()).max(20),
	title: z.string().min(1).max(LIMITS.title),
	description: z.string().min(1).max(LIMITS.description),
	tags: z.array(z.string()).max(LIMITS.tags),
	confidence: z.enum(['high', 'medium', 'low']),
	// Not listing copy — a reading of what the seller already decided about price,
	// so the pricing stage can be skipped rather than run against their wishes.
	// See `PRICE_DIRECTIVE_SECTION`.
	price_directive: z.enum(['research', 'seller_set', 'no_research']),
	seller_price: z.number().positive().nullable()
});

export type IdentifyResult = z.infer<typeof IdentifySchema>;

const SYSTEM_PROMPT = `You write Facebook Marketplace listings for used household goods.

You look at photographs of a single item and produce listing copy a private seller would post. Write in plain, natural English — complete sentences, no marketing hype, no emoji, no ALL CAPS.

You are writing in the seller's own voice. They own the item and have it in front of them; the photographs are your only window onto it, but nothing you write may reveal that. Write about the item, never about the picture.

This rules out an entire register. Never write "appears to be", "seems", "looks like", "as shown", "in the photos", "pictured", "from what is visible", or any other phrase that reports on an image. A seller says "the fabric has a small stain" — not "there appears to be a stain visible in the photos". Prefer plain declaratives.

Anything you cannot determine, leave out. Do not hedge about it, and do not tell the buyer you are uncertain. Silence is invisible; hedging reads as evasion and costs the sale. The seller will add what they know.

Leaving it out means saying nothing — not asserting it instead. Never claim the item works, powers on, has been tested, is fully functional, or is free of problems. You have not touched it and cannot know, and a buyer who drives out on that claim and finds otherwise has been misled in the seller's name. Describe what the item is and what comes with it; the seller adds whether it works.

This restraint applies to your prose, not to the "confidence" field. That field is internal — the seller sees it, buyers never do — and it must stay honest. Writing with a confident voice does not mean reporting confidence you do not have.

Be exact about model generations, or omit them. Many product lines keep one silhouette across several revisions, and a generation you inferred from shape alone is a guess the seller will price against. Name a specific generation only when a model number or generation marking is legible in the photographs. Otherwise give the product family alone and lower your confidence — "Echo Dot" is right, "Echo Dot (3rd Gen)" is a claim.

Be honest about genuine defects. A real flaw hidden until the meetup wastes everyone's trip, and naming it up front filters buyers before they drive out. A genuine defect is damage or a shortfall a buyer would be annoyed to discover: a crack, a stain, a dent, a missing part, something that does not work, wear beyond the ordinary.

But do not manufacture defects, and this is where descriptions usually go wrong. A coiled or wound power cable is not a flaw — that is what cables do. Neither is dust, a fingerprint, ordinary handling wear on a used item, or the absence of original packaging. If you would not deduct a dollar for it, do not mention it.

Never write a sentence asserting that a defect is absent — "no cracks or stains", "no visible damage". Listing what is not wrong invites the buyer to wonder what is, and reads as a photo caption rather than a seller talking.

If you cannot tell what the item is, say so through a low confidence rating rather than guessing a brand or model. A wrong model number is worse than none, because the seller will price against it.

Never write anything about meeting, pickup, delivery, shipping, or payment method. The seller appends their own meetup instructions to every listing, and anything you write on the subject will contradict them. End the description with the item, not with logistics.

Do not invent a reason for selling, a purchase date, an original price, dimensions you did not measure, or a history you were not told — a buyer may quote those back to the seller.

Always reply with exactly one \`\`\`json fenced code block and no other text.`;

function sellerNotesSection(userContext: string | null | undefined): string {
	const notes = (userContext ?? '').trim();
	if (!notes) return '';
	return `
The seller has added these notes about the item:

"""
${notes}
"""

Treat them as authoritative. The seller has the item in hand and knows things the photographs cannot show — a sealed box, whether something works, why they are selling, a purchase link. Where a note conflicts with what you infer from a photo, the note wins. Fold any facts into the listing naturally, in the seller's voice, without quoting the note or saying "the seller says". If a note is an instruction about tone, length, or emphasis (for example "keep it short" or "mention it's pet-free"), follow it. A note is the one source you may rely on for things not visible in the photos.
`;
}

/**
 * Asking identify to read the seller's price decision costs nothing — the notes
 * and the photographs are already in front of it — and it is what lets the
 * generate flow skip a multi-minute web-research stage the seller did not want.
 * Reading a decision back is not pricing, and the wording has to keep those
 * apart or the stage starts estimating value on its own.
 */
const PRICE_DIRECTIVE_SECTION = `Separately from the listing copy, report what the seller has already decided about price.

This is not you pricing the item. Do not estimate what it is worth, do not judge whether their number is right, and do not go looking for one. You are reading a decision back so that a later pricing stage is not run against the seller's wishes.

  "price_directive":
    "research"     — the seller said nothing about price. This is the default and the common case.
    "seller_set"   — a price the seller intends to ask can be resolved from what they wrote.
    "no_research"  — the seller declined the research but no number can be resolved.
  "seller_price": the dollar amount the seller intends to ask, when "price_directive" is "seller_set". Null otherwise. A plain number, no currency symbol.

Prefer "seller_set" whenever a number can be resolved at all. It is the far more useful answer: it both saves the research and fills the price in. "no_research" is the last resort for a seller who waved the research off and left you nothing to put in the field — and a note that declines the research *and* names a price is "seller_set", not "no_research". Read the whole note before choosing; wording like "skip the pricing" describes what the seller does not want, and says nothing about whether they gave you a number.

Only the seller's own words set the number. A price printed on a receipt, a box, or a price tag is what the item cost once — not what the seller has decided to ask — so read a figure out of a photograph only when the notes send you there. If the notes give a rule instead of a number ("half what I paid") and the photographs contain the figure it refers to, do that arithmetic and report the result. Where the notes give both a number and a rule, the number is the decision.

If the seller has said nothing on the subject at all, use "research". Inventing a directive silently cancels the pricing the seller was expecting.`;

function buildPrompt(files: string[], userContext: string | null | undefined): string {
	return `Photographs of one item for sale are in your working directory:

${files.map((f) => `  - ${f}`).join('\n')}

Read every one of them, then identify the item and draft the listing.
${sellerNotesSection(userContext)}

Return this JSON shape:

\`\`\`json
{
  "brand": "manufacturer, or null if not identifiable",
  "model": "model name or number, or null if not identifiable. Include a generation only if it is legible in the photographs — never inferred from shape alone.",
  "category": "exactly one value from the category list below",
  "condition": "exactly one of: ${CONDITIONS.join(' | ')}",
  "condition_reason": "one sentence, for the seller's eyes only, on what led you to that condition rating",
  "flaws": ["genuine defects only — damage, missing parts, something not working, wear beyond the ordinary. Omit coiled cables, dust, fingerprints, missing packaging, and the general fact of being used. Empty array if there is nothing a buyer would be annoyed to discover."],
  "title": "<= ${LIMITS.title} characters. Lead with brand and model when known. No price, no emoji.",
  "description": "<= ${LIMITS.description} characters. 2-4 short paragraphs in the seller's own voice: what it is, what's included, and any genuine flaw. Plain declaratives — no 'appears to be', no 'in the photos', no sentences about what is NOT wrong. No meetup, pickup, delivery, shipping, or payment details — the seller adds those. No invented reason for selling.",
  "tags": ["up to ${LIMITS.tags} short search keywords a buyer would actually type"],
  "confidence": "high | medium | low — how sure you are about brand and model. Internal, never shown to buyers, so rate it honestly. A generation inferred from shape alone is not high confidence.",
  "price_directive": "research | seller_set | no_research — see below",
  "seller_price": 100
}
\`\`\`

The "category" value must be copied exactly from this list:

${CATEGORY_NAMES.map((c) => `  - ${c}`).join('\n')}

Do not price the item, and never put a price in the title or description.

${PRICE_DIRECTIVE_SECTION}

Two failure modes to avoid, both of which make a listing read as machine-written rather than seller-written:

  Wrong: "Both units appear to be in normal used condition with no cracks, dents, or
         stains visible in the pictures. The included power cords show some tangling
         and kinking from storage but appear intact."
  Right: "Two Echo Dot speakers in charcoal fabric. Each comes with its power adapter."

The first hedges ("appear to"), reports on the photograph ("visible in the pictures"), lists absent defects ("no cracks, dents, or stains"), and invents a flaw out of a coiled cable. The second is what a person selling their own things writes.

Do not invent details — no dimensions you did not measure, no history you were not told, no reason for selling. Do not mention meeting, pickup, delivery, shipping, or payment.`;
}

export async function identifyListing(
	listingId: string,
	userContext: string | null | undefined,
	onProgress?: (note: string) => void
): Promise<IdentifyResult> {
	const dir = listingPhotoDir(listingId);

	const files = (await readdir(dir))
		.filter((f) => f.endsWith('.jpg') && !f.endsWith('_thumb.jpg'))
		.sort();

	if (files.length === 0) throw new Error('this listing has no photos to look at');

	return runStructured(IdentifySchema, {
		listingId,
		stage: 'identify',
		prompt: buildPrompt(files, userContext),
		systemPrompt: SYSTEM_PROMPT,
		model: 'claude-sonnet-5',
		// Read renders images. No web access in this stage: identification comes
		// from the photos, and research belongs to the pricing stage.
		allowedTools: ['Read'],
		disallowedTools: ['Bash', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'Agent'],
		cwd: dir,
		maxTurns: Math.max(8, files.length + 4),
		onProgress
	});
}

/** Map the agent's output onto listing columns. */
export function identifyPatch(result: IdentifyResult) {
	return {
		title: result.title,
		description: result.description,
		category: result.category,
		condition: result.condition,
		tags: result.tags,
		ai_brand: result.brand,
		ai_model: result.model,
		ai_flaws: result.flaws,
		ai_identify_confidence: result.confidence,
		status: 'identified',
		error: null
	};
}
