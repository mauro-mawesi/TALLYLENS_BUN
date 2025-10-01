/**
 * Category and Unit mapping utilities for internationalization
 *
 * Internal categories and units are in English for better maintainability
 * External categories and units depend on user's language preference
 */

// Internal category values (English - used in database)
export const INTERNAL_CATEGORIES = ['grocery', 'transport', 'food', 'fuel', 'others'];

// Mapping from external localized values to internal English values
export const CATEGORY_LOCALIZED_TO_INTERNAL = {
    // Spanish to English
    'Mercado': 'grocery',
    'Transporte': 'transport',
    'Comida': 'food',
    'Combustible': 'fuel',
    'Otros': 'others',

    // English to English (direct mapping)
    'grocery': 'grocery',
    'market': 'grocery',  // Common synonym for grocery
    'transport': 'transport',
    'transportation': 'transport',  // Full form
    'food': 'food',
    'fuel': 'fuel',
    'others': 'others',

    // Dutch to English
    'Supermarkt': 'grocery',
    'Transport': 'transport',
    'Eten': 'food',
    'Brandstof': 'fuel',
    'Overige': 'others'
};

// Mapping from internal English values to localized values by language
export const CATEGORY_INTERNAL_TO_LOCALIZED = {
    'en': {
        'grocery': 'Grocery',
        'transport': 'Transportation',
        'food': 'Food',
        'fuel': 'Fuel',
        'others': 'Others'
    },
    'es': {
        'grocery': 'Mercado',
        'transport': 'Transporte',
        'food': 'Comida',
        'fuel': 'Combustible',
        'others': 'Otros'
    },
    'nl': {
        'grocery': 'Supermarkt',
        'transport': 'Transport',
        'food': 'Eten',
        'fuel': 'Brandstof',
        'others': 'Overige'
    }
};

// All valid category values (for validation)
export const ALL_VALID_CATEGORIES = Object.keys(CATEGORY_LOCALIZED_TO_INTERNAL);

/**
 * Maps a localized category to internal English format
 * @param {string} category - Category in any supported language
 * @returns {string|null} - Category in English format or null if invalid
 */
export const mapCategoryToInternal = (category) => {
    if (!category) return null;
    return CATEGORY_LOCALIZED_TO_INTERNAL[category] || null;
};

/**
 * Maps an internal English category to localized format
 * @param {string} category - Category in English
 * @param {string} language - Target language (en, es, nl)
 * @returns {string} - Localized category or original if mapping not found
 */
export const mapCategoryToLocalized = (category, language = 'en') => {
    if (!category) return category;
    const mapping = CATEGORY_INTERNAL_TO_LOCALIZED[language];
    return mapping?.[category] || category;
};

/**
 * Validates if a category is supported
 * @param {string} category - Category to validate
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidCategory = (category) => {
    return ALL_VALID_CATEGORIES.includes(category);
};

/**
 * Express middleware to automatically map category parameters to internal format
 */
export const mapCategoryParams = (req, res, next) => {
    // Map query parameters
    if (req.query && req.query.category) {
        const internalCategory = mapCategoryToInternal(req.query.category);
        if (internalCategory) {
            req.query.category = internalCategory;
        }
    }

    // Map body parameters
    if (req.body && req.body.category) {
        const internalCategory = mapCategoryToInternal(req.body.category);
        if (internalCategory) {
            req.body.category = internalCategory;
        }
    }

    next();
};

// =================== UNIT MAPPING ===================

// Internal unit values (English - used in database)
export const INTERNAL_UNITS = ['unit', 'kg', 'g', 'l', 'ml', 'package', 'box', 'bottle'];

// Mapping from external localized values to internal English values
export const UNIT_LOCALIZED_TO_INTERNAL = {
    // Spanish to English
    'unidad': 'unit',
    'kg': 'kg',
    'g': 'g',
    'l': 'l',
    'ml': 'ml',
    'paquete': 'package',
    'caja': 'box',
    'botella': 'bottle',

    // English to English (direct mapping)
    'unit': 'unit',
    'piece': 'unit',  // Common synonym
    'each': 'unit',   // Another synonym
    'kg': 'kg',
    'g': 'g',
    'l': 'l',
    'ml': 'ml',
    'package': 'package',
    'box': 'box',
    'bottle': 'bottle',

    // Dutch to English
    'stuk': 'unit',
    'per stuk': 'unit',
    'kg': 'kg',
    'g': 'g',
    'l': 'l',
    'ml': 'ml',
    'pakket': 'package',
    'doos': 'box',
    'fles': 'bottle'
};

// Mapping from internal English values to localized values by language
export const UNIT_INTERNAL_TO_LOCALIZED = {
    'en': {
        'unit': 'Unit',
        'kg': 'Kg',
        'g': 'g',
        'l': 'L',
        'ml': 'ml',
        'package': 'Package',
        'box': 'Box',
        'bottle': 'Bottle'
    },
    'es': {
        'unit': 'Unidad',
        'kg': 'Kg',
        'g': 'g',
        'l': 'L',
        'ml': 'ml',
        'package': 'Paquete',
        'box': 'Caja',
        'bottle': 'Botella'
    },
    'nl': {
        'unit': 'Stuk',
        'kg': 'Kg',
        'g': 'g',
        'l': 'L',
        'ml': 'ml',
        'package': 'Pakket',
        'box': 'Doos',
        'bottle': 'Fles'
    }
};

// All valid unit values (for validation)
export const ALL_VALID_UNITS = Object.keys(UNIT_LOCALIZED_TO_INTERNAL);

/**
 * Maps a localized unit to internal English format
 * @param {string} unit - Unit in any supported language
 * @returns {string|null} - Unit in English format or null if invalid
 */
export const mapUnitToInternal = (unit) => {
    if (!unit) return null;
    return UNIT_LOCALIZED_TO_INTERNAL[unit] || null;
};

/**
 * Maps an internal English unit to localized format
 * @param {string} unit - Unit in English
 * @param {string} language - Target language (en, es, nl)
 * @returns {string} - Localized unit or original if mapping not found
 */
export const mapUnitToLocalized = (unit, language = 'en') => {
    if (!unit) return unit;
    const mapping = UNIT_INTERNAL_TO_LOCALIZED[language];
    return mapping?.[unit] || unit;
};

/**
 * Validates if a unit is supported
 * @param {string} unit - Unit to validate
 * @returns {boolean} - True if valid, false otherwise
 */
export const isValidUnit = (unit) => {
    return ALL_VALID_UNITS.includes(unit);
};