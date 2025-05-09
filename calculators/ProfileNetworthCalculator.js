const { getPrices } = require('../helper/prices');
const { parseItems } = require('../helper/parseItems');
const networthManager = require('../managers/NetworthManager');
const SkyBlockItemNetworthCalculator = require('./SkyBlockItemNetworthCalculator');
const PetNetworthCalculator = require('./PetNetworthCalculator');
const BasicItemNetworthCalculator = require('./BasicItemNetworthCalculator');
const { ValidationError } = require('../helper/errors');

const categoryCalculatorMap = {
    pets: PetNetworthCalculator,
    sacks: BasicItemNetworthCalculator,
    essence: BasicItemNetworthCalculator,
    default: SkyBlockItemNetworthCalculator,
};

// @ts-check

/**
 * @typedef {import('../index').ProfileNetworthCalculator} ProfileNetworthCalculator
 * @typedef {import('../types/ProfileNetworthCalculator').NetworthResult} NetworthResult
 * @typedef {import('../types/global').NetworthOptions} NetworthOptions
 */

/**
 * ProfileNetworthCalculator class.
 * Calculates the networth of a player's profile.
 * @implements {ProfileNetworthCalculator}
 */
class ProfileNetworthCalculator {
    constructor(profileData, museumData, bankBalance) {
        this.profileData = profileData;
        this.museumData = museumData || {};
        this.bankBalance = bankBalance ?? 0;
        this.items = {};

        this.#validate();

        this.purse = profileData.currencies?.coin_purse ?? 0;
        this.personalBankBalance = profileData.profile?.bank_account ?? 0;
    }

    /**
     * Creates a new PreDecodedNetworthCalculator
     * @param {object} profileData The profile data from the Hypixel API (profile.members[uuid])
     * @param {{
     *          armor: [],
     *          equipment: [],
     *          wardrobe: [],
     *          inventory: [],
     *          enderchest: [],
     *          accessories: [],
     *          personal_vault: [],
     *          storage: [],
     *          fishing_bag: [],
     *          potion_bag: [],
     *          sacks_bag: [],
     *          candy_inventory: [],
     *          carnival_mask_inventory: [],
     *          quiver: [],
     *          museum: [],
     *        }} items Pre-parsed inventories, most inventories are just decoded except for sacks, essence, and pets which are parsed specifically as listed above, museum is an array of member[uuid].items and member[uuid].special combined and decoded (see {@link parseItems})
     * @param {number} bankBalance The bank balance of the player from the Hypixel API (profile.banking.balance)
     */
    static fromPreParsed(profileData, items, bankBalance) {
        const calculator = new ProfileNetworthCalculator(profileData, {}, bankBalance);
        calculator.items = items;
        return calculator;
    }

    /**
     * Validates that the profile data is correct
     */
    #validate() {
        if (!this.profileData) {
            throw new ValidationError('Profile data must be provided');
        }

        if (typeof this.profileData !== 'object') {
            throw new ValidationError('Profile data must be an object');
        }

        if (!this.profileData.profile && !this.profileData.player_data && !this.profileData.leveling) {
            throw new ValidationError('Invalid profile data provided');
        }
    }

    /**
     * Gets the networth of the player.
     * @param {NetworthOptions} [options]   The options for calculating networth.
     * @returns {Promise<NetworthResult>} The networth result.
     */
    async getNetworth(options) {
        return this.#calculate({ ...options, nonCosmetic: false });
    }

    /**
     * Gets the networth of the player without the cosmetic items.
     * @param {NetworthOptions} [options] The options for calculating networth.
     * @returns {Promise<NetworthResult>} The networth result.
     */
    async getNonCosmeticNetworth(options) {
        return this.#calculate({ ...options, nonCosmetic: true });
    }

    /**
     * Calculates the networth of a profile
     * @param {NetworthOptions} [options] The options for calculating networth.
     * @returns {Promise<NetworthResult>} The networth result.
     */
    async #calculate({ prices, nonCosmetic, cachePrices, pricesRetries, cachePricesTime, onlyNetworth, includeItemData, sortItems, stackItems }) {
        // Set default options
        cachePrices ??= networthManager.getCachePrices();
        pricesRetries ??= networthManager.getPricesRetries();
        cachePricesTime ??= networthManager.getCachePricesTime();
        onlyNetworth ??= networthManager.getOnlyNetworth();
        includeItemData ??= networthManager.getIncludeItemData();
        sortItems ??= networthManager.getSortItems();
        stackItems ??= networthManager.getStackItems();

        // Get prices and items
        await networthManager.itemsPromise;
        if (!prices) {
            prices = await getPrices(cachePrices, pricesRetries, cachePricesTime);
        }

        // Parse inventories if not already parsed
        if (!this.items || !Object.keys(this.items).length) {
            this.items = await parseItems(this.profileData, this.museumData);
        }

        // Calculate networth for each category
        const categories = {};
        const rawCoinsBalance = (this.bankBalance ?? 0) + (this.purse ?? 0) + (this.personalBankBalance ?? 0);
        let total = rawCoinsBalance;
        let unsoulboundTotal = rawCoinsBalance;

        for (const [category, categoryItems] of Object.entries(this.items)) {
            if (!categoryItems || !categoryItems.length) {
                continue;
            }

            const categoryData = { total: 0, unsoulboundTotal: 0 };
            if (!onlyNetworth) {
                categoryData.items = [];
            }

            // Calculate networth for each item in the category
            for (let item of categoryItems) {
                if (!item || Object.keys(item).length === 0) continue;

                // Get the calculator for the item
                let calculatorClass = categoryCalculatorMap[category] ?? categoryCalculatorMap.default;
                /**
                 * @type {SkyBlockItemNetworthCalculator | PetNetworthCalculator | BasicItemNetworthCalculator}
                 */

                if (item.tag?.ExtraAttributes?.petInfo) {
                    try {
                        item = JSON.parse(item.tag.ExtraAttributes.petInfo);
                        calculatorClass = PetNetworthCalculator;
                    } catch {
                        continue;
                    }
                } else if (!item.tag?.ExtraAttributes && item.exp === undefined && typeof item.id !== 'string') {
                    continue;
                }

                // Instantiate the calculator
                let calculator;
                try {
                    calculator = new calculatorClass(item);
                } catch {
                    continue;
                }
                // Calculate the networth of the item
                const result = nonCosmetic
                    ? await calculator.getNonCosmeticNetworth({ prices, includeItemData })
                    : await calculator.getNetworth({ prices, includeItemData });
                if (!result) {
                    continue;
                }

                // Add the item to the category
                const price = isNaN(result.price) ? 0 : result.price;
                if (price <= 0) {
                    continue;
                }

                const soulboundPortion = isNaN(result.soulboundPortion) ? 0 : result.soulboundPortion;
                categoryData.total += price;

                if (!result.soulbound) {
                    categoryData.unsoulboundTotal += price - soulboundPortion;
                }

                if (!onlyNetworth) {
                    categoryData.items.push(result);
                }
            }

            // Sort items by price
            if (sortItems && !onlyNetworth && categoryData.items?.length > 0) {
                categoryData.items.sort((a, b) => b.price - a.price);
            }

            // Stack items with the same id and price
            if (stackItems && !onlyNetworth && categoryData.items?.length > 0) {
                const stacked = [];
                const pets = [];

                for (const item of categoryData.items) {
                    if (item.isPet) {
                        pets.push(item);
                    } else {
                        const existing = stacked.find(
                            (existingItem) =>
                                existingItem.id === item.id &&
                                existingItem.price / existingItem.count === item.price / item.count &&
                                existingItem.soulbound === item.soulbound,
                        );

                        if (existing) {
                            existing.price += item.price;
                            existing.count += item.count;
                            existing.basePrice = existing.basePrice || item.basePrice;
                            existing.calculation = existing.calculation || item.calculation;
                        } else {
                            stacked.push(item);
                        }
                    }
                }

                categoryData.items = [...stacked, ...pets];
            }

            if (categoryData.total > 0) {
                total += categoryData.total;
                unsoulboundTotal += categoryData.unsoulboundTotal;
                categories[category] = categoryData;
            }
        }

        return {
            networth: total,
            unsoulboundNetworth: unsoulboundTotal,
            noInventory: !this.items.inventory?.length,
            isNonCosmetic: !!nonCosmetic,
            purse: this.purse ?? 0,
            bank: this.bankBalance ?? 0,
            personalBank: this.personalBankBalance ?? 0,
            types: categories,
        };
    }
}

module.exports = ProfileNetworthCalculator;
