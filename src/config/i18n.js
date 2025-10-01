import { I18n } from 'i18n';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'accept-language-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure i18n
const i18n = new I18n({
    locales: ['en', 'es', 'nl'],
    defaultLocale: 'en',
    directory: path.join(__dirname, '../../locales'),
    updateFiles: false,
    objectNotation: true,
    logDebugFn: function (msg) {
        console.log('i18n debug', msg);
    },
    logWarnFn: function (msg) {
        console.warn('i18n warn', msg);
    },
    logErrorFn: function (msg) {
        console.error('i18n error', msg);
    },
    api: {
        __: 't',  // function name for translate
        __n: 'tn' // function name for pluralize
    },
    register: global
});

/**
 * Middleware to detect and set user language
 */
const detectLanguage = (req) => {
    let locale = 'en'; // default

    // 1. Check for explicit locale in query params (?lang=es)
    if (req.query.lang && i18n.getLocales().includes(req.query.lang)) {
        locale = req.query.lang;
    }
    // 2. Check for locale in custom header
    else if (req.headers['x-locale'] && i18n.getLocales().includes(req.headers['x-locale'])) {
        locale = req.headers['x-locale'];
    }
    // 3. Check for user preference in JWT payload (only if user is available)
    else if (req.user && req.user.preferredLanguage && i18n.getLocales().includes(req.user.preferredLanguage)) {
        locale = req.user.preferredLanguage;
    }
    // 4. Parse Accept-Language header
    else if (req.headers['accept-language']) {
        try {
            const acceptedLanguages = parse(req.headers['accept-language']);
            for (const lang of acceptedLanguages) {
                // Check for exact match (e.g., 'es-ES' -> 'es')
                const langCode = lang.code.split('-')[0];
                if (i18n.getLocales().includes(langCode)) {
                    locale = langCode;
                    break;
                }
            }
        } catch (error) {
            console.warn('Error parsing Accept-Language header:', error.message);
        }
    }

    return locale;
};

const setupI18nForRequest = (req, locale) => {
    // Set locale for this request
    req.locale = locale;
    i18n.setLocale(req, locale);

    // Add translation functions to request
    req.t = (key, options = {}) => {
        try {
            return i18n.__(req, key, options);
        } catch (error) {
            console.warn('i18n translation error:', error.message, 'key:', key);
            return key; // fallback to key if translation fails
        }
    };
    req.tn = (singular, plural, count, options = {}) => {
        try {
            return i18n.__n(req, singular, plural, count, options);
        } catch (error) {
            console.warn('i18n pluralization error:', error.message);
            return count === 1 ? singular : plural;
        }
    };
};

export const languageDetector = (req, res, next) => {
    const locale = detectLanguage(req);
    setupI18nForRequest(req, locale);
    next();
};

// Middleware for authenticated routes to re-check language with user preferences
export const languageDetectorAuth = (req, res, next) => {
    if (req.user) {
        // Re-detect language now that we have user info
        const locale = detectLanguage(req);
        setupI18nForRequest(req, locale);
    }
    next();
};

/**
 * Helper function to get localized category names
 */
export const getLocalizedCategories = (type, locale = 'en') => {
    i18n.setLocale(locale);

    if (type === 'receipt') {
        return {
            'Mercado': i18n.__('categories.receipt.Mercado'),
            'Transporte': i18n.__('categories.receipt.Transporte'),
            'Comida': i18n.__('categories.receipt.Comida'),
            'Combustible': i18n.__('categories.receipt.Combustible'),
            'Otros': i18n.__('categories.receipt.Otros')
        };
    } else if (type === 'product') {
        return {
            'Alimentos': i18n.__('categories.product.Alimentos'),
            'Bebidas': i18n.__('categories.product.Bebidas'),
            'Limpieza': i18n.__('categories.product.Limpieza'),
            'Higiene': i18n.__('categories.product.Higiene'),
            'Farmacia': i18n.__('categories.product.Farmacia'),
            'Otros': i18n.__('categories.product.Otros')
        };
    }

    return {};
};

/**
 * Helper function to get AI prompts - always in English for better LLM understanding
 * The response language is controlled by the prompt instructions
 */
export const getAIPrompts = (locale = 'en') => {
    const categoryTranslations = {
        en: {
            grocery: 'Grocery',
            transportation: 'Transportation',
            food: 'Food',
            fuel: 'Fuel',
            others: 'Others',
            foodItems: 'Food',
            beverages: 'Beverages',
            cleaning: 'Cleaning',
            hygiene: 'Personal Care',
            pharmacy: 'Pharmacy'
        },
        es: {
            grocery: 'Mercado',
            transportation: 'Transporte',
            food: 'Comida',
            fuel: 'Combustible',
            others: 'Otros',
            foodItems: 'Alimentos',
            beverages: 'Bebidas',
            cleaning: 'Limpieza',
            hygiene: 'Higiene',
            pharmacy: 'Farmacia'
        },
        nl: {
            grocery: 'Supermarkt',
            transportation: 'Transport',
            food: 'Eten',
            fuel: 'Brandstof',
            others: 'Overige',
            foodItems: 'Voedsel',
            beverages: 'Dranken',
            cleaning: 'Schoonmaak',
            hygiene: 'Persoonlijke verzorging',
            pharmacy: 'Apotheek'
        }
    };

    const translations = categoryTranslations[locale] || categoryTranslations.en;

    return {
        receiptClassifier: `You are a receipt classifier. Analyze the text and return ONLY one category:
- ${translations.grocery} (grocery stores, supermarkets, food and household products)
- ${translations.transportation} (transportation: taxis, buses, Uber, ride-sharing)
- ${translations.food} (restaurants, cafes, fast food, dining)
- ${translations.fuel} (fuel: gasoline, diesel, gas stations)
- ${translations.others} (everything else)

Respond ONLY with the category name in the target language. No explanations or additional text.`,

        productClassifier: `You are a grocery product classifier. Analyze the product name and return ONLY one category from these exact options:

- food (meat, fruits, vegetables, dairy, cereals, canned goods, snacks, frozen foods, bakery items, etc.)
- beverages (water, juices, soft drinks, alcohol, coffee, tea, energy drinks, milk, etc.)
- cleaning (detergents, soaps, cleaners, toilet paper, paper towels, dishwashing liquid, etc.)
- personal_care (shampoo, soap, deodorant, toothpaste, cosmetics, lotions, razors, etc.)
- pharmacy (medications, vitamins, first aid, supplements, bandages, pain relief, etc.)
- transport (transportation tickets, fuel cards, car accessories, etc.)
- fuel (gasoline, diesel, propane, energy for vehicles, etc.)
- others (household items, electronics, tools, anything not fitting above categories, etc.)

IMPORTANT: Respond with ONLY the English category name exactly as listed above. No explanations, translations, or additional text.

Examples:
Spanish:
- "Refresco de cola" → beverages
- "Queso cheddar" → food
- "Huevos" → food
- "Kéfir" → beverages
- "Anacardos" → food
- "Detergente" → cleaning
- "Shampoo" → personal_care
- "Aspirina" → pharmacy

Dutch:
- "Coca Cola" → beverages
- "Melk" → beverages
- "Kaas" → food
- "Brood" → food
- "Eieren" → food
- "Wasmiddel" → cleaning
- "Tandpasta" → personal_care
- "Benzine" → fuel
- "Paracetamol" → pharmacy`,

        receiptProcessor: `You are an expert receipt analysis AI. Analyze the receipt text and extract ALL information in a single comprehensive response.`,

        productNormalizer: `You are a grocery product name translator and normalizer. Translate and normalize product names to Spanish.`
    };
};

export default i18n;