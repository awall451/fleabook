/**
 * Curated subset of the Facebook Marketplace category tree covering household
 * goods. The identify agent must pick from this list — free-text categories mean
 * hand-fixing every listing, since Facebook's form is a fixed dropdown.
 *
 * `depreciation` keys into RETENTION in ./depreciation.ts (used by the price agent).
 */

export interface Category {
	/** Value stored on the listing and shown in the dropdown. */
	name: string;
	/** Facebook's top-level grouping, for optgroup display. */
	group: string;
	/** Retention-curve bucket. */
	depreciation: string;
}

export const CATEGORIES: Category[] = [
	// Home & Garden
	{ name: 'Furniture — Sofas & Seating', group: 'Home & Garden', depreciation: 'furniture_solid' },
	{ name: 'Furniture — Tables & Desks', group: 'Home & Garden', depreciation: 'furniture_solid' },
	{ name: 'Furniture — Beds & Mattresses', group: 'Home & Garden', depreciation: 'furniture_flatpack' },
	{ name: 'Furniture — Storage & Shelving', group: 'Home & Garden', depreciation: 'furniture_flatpack' },
	{ name: 'Furniture — Dressers & Cabinets', group: 'Home & Garden', depreciation: 'furniture_solid' },
	{ name: 'Home Decor', group: 'Home & Garden', depreciation: 'default' },
	{ name: 'Kitchen & Dining', group: 'Home & Garden', depreciation: 'kitchenware' },
	{ name: 'Cookware & Bakeware', group: 'Home & Garden', depreciation: 'cast_iron' },
	{ name: 'Small Kitchen Appliances', group: 'Home & Garden', depreciation: 'small_appliance' },
	{ name: 'Major Appliances', group: 'Home & Garden', depreciation: 'small_appliance' },
	{ name: 'Home Improvement Supplies', group: 'Home & Garden', depreciation: 'default' },
	{ name: 'Garden & Outdoor', group: 'Home & Garden', depreciation: 'default' },
	{ name: 'Rugs & Textiles', group: 'Home & Garden', depreciation: 'default' },
	{ name: 'Lighting', group: 'Home & Garden', depreciation: 'default' },

	// Tools
	{ name: 'Power Tools', group: 'Tools', depreciation: 'power_tools' },
	{ name: 'Hand Tools', group: 'Tools', depreciation: 'hand_tools' },
	{ name: 'Lawn Mowers & Yard Equipment', group: 'Tools', depreciation: 'power_tools' },
	{ name: 'Tool Storage', group: 'Tools', depreciation: 'hand_tools' },

	// Electronics
	{ name: 'Computers & Tablets', group: 'Electronics', depreciation: 'electronics' },
	{ name: 'Computer Accessories', group: 'Electronics', depreciation: 'electronics' },
	{ name: 'Cell Phones & Accessories', group: 'Electronics', depreciation: 'electronics' },
	{ name: 'TVs & Video', group: 'Electronics', depreciation: 'electronics' },
	{ name: 'Audio Equipment', group: 'Electronics', depreciation: 'electronics' },
	{ name: 'Cameras & Photo', group: 'Electronics', depreciation: 'electronics' },
	{ name: 'Video Games & Consoles', group: 'Electronics', depreciation: 'electronics' },

	// Sporting & Outdoors
	{ name: 'Exercise Equipment', group: 'Sporting Goods', depreciation: 'exercise' },
	{ name: 'Bicycles', group: 'Sporting Goods', depreciation: 'default' },
	{ name: 'Camping & Hiking', group: 'Sporting Goods', depreciation: 'default' },
	{ name: 'Sports Equipment', group: 'Sporting Goods', depreciation: 'default' },

	// Family
	{ name: 'Baby & Kids Furniture', group: 'Family', depreciation: 'kids_gear' },
	{ name: 'Strollers & Car Seats', group: 'Family', depreciation: 'kids_gear' },
	{ name: 'Toys & Games', group: 'Family', depreciation: 'kids_gear' },

	// Hobbies
	{ name: 'Musical Instruments', group: 'Hobbies', depreciation: 'furniture_solid' },
	{ name: 'Books, Movies & Music', group: 'Hobbies', depreciation: 'default' },
	{ name: 'Arts & Crafts', group: 'Hobbies', depreciation: 'default' },
	{ name: 'Antiques & Collectibles', group: 'Hobbies', depreciation: 'cast_iron' },

	// Apparel
	{ name: 'Clothing & Shoes', group: 'Apparel', depreciation: 'default' },
	{ name: 'Bags & Luggage', group: 'Apparel', depreciation: 'default' },

	// Catch-all
	{ name: 'Miscellaneous', group: 'Other', depreciation: 'default' }
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

export function categoryGroups(): { group: string; categories: Category[] }[] {
	const groups: { group: string; categories: Category[] }[] = [];
	for (const category of CATEGORIES) {
		let bucket = groups.find((g) => g.group === category.group);
		if (!bucket) {
			bucket = { group: category.group, categories: [] };
			groups.push(bucket);
		}
		bucket.categories.push(category);
	}
	return groups;
}

export function depreciationKeyFor(categoryName: string | null): string {
	return CATEGORIES.find((c) => c.name === categoryName)?.depreciation ?? 'default';
}
