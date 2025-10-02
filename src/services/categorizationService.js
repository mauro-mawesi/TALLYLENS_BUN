import OpenAI from "openai";
import logger, { log } from "../utils/logger.js";
import { getAIPrompts } from "../config/i18n.js";
import { mapCategoryToInternal } from "../utils/categoryMapper.js";
import crypto from "crypto";
import cacheService from "./cacheService.js";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

export async function categorizeReceipt(text, locale = 'en') {
    try {
        const prompts = getAIPrompts(locale);

        const completion = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: prompts.receiptClassifier
                },
                { role: "user", content: text },
            ],
            max_tokens: 10,
        });

        // Get the AI response
        const aiCategory = completion.choices[0].message.content.trim();

        // Map to internal English format
        const internalCategory = mapCategoryToInternal(aiCategory);

        // Return the internal English category or fallback
        return internalCategory || 'others';
    } catch (err) {
        log.error("Error en categorización de recibo:", err);
        // Always return internal English category
        return 'others';
    }
}

export async function categorizeProduct(productName, locale = 'en') {
    try {
        const prompts = getAIPrompts(locale);

        const completion = await client.chat.completions.create({
            model: "openai/gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: prompts.productClassifier
                },
                { role: "user", content: productName },
            ],
            max_tokens: 10,
        });

        // Get the AI response (already in English)
        const aiCategory = completion.choices[0].message.content.trim().toLowerCase();

        // Validate it's one of our allowed categories
        const validCategories = ['food', 'beverages', 'cleaning', 'personal_care', 'pharmacy', 'transport', 'fuel', 'others'];

        // Return the category if valid, otherwise fallback
        return validCategories.includes(aiCategory) ? aiCategory : 'others';
    } catch (err) {
        log.error("Error en categorización de producto:", err);
        // Always return internal English category
        return 'others';
    }
}

export async function processReceiptWithAI(receiptText, locale = 'en') {
    try {
        logger.info('processReceiptWithAI called with locale:', locale, 'text length:', receiptText?.length);

        // 1) Cache by content hash to avoid recomputing
        const hash = crypto.createHash('sha256').update(String(receiptText || '')).digest('hex');
        const cacheKey = `ai:receipt:unified:${locale}:${hash}`;
        try {
            const cached = await cacheService.get(cacheKey);
            if (cached?.success) {
                log.info('AI unified result cache hit', { locale, hash: hash.substring(0,8) });
                return cached;
            }
        } catch {}

        // 2) Pre-trim noisy text to reduce token usage and latency
        const compactText = String(receiptText || '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            // keep top and bottom segments where totals often are
            .slice(0, 80)
            .concat(['\n...\n'])
            .concat(String(receiptText || '').split(/\r?\n/).slice(-60))
            .join('\n')
            .slice(0, 8000); // hard cap

        const prompts = getAIPrompts(locale);

        // Helper: robust JSON extraction
        const extractJson = (txt) => {
            if (!txt) return null;
            // Remove code fences if present
            let s = String(txt).trim();
            s = s.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            // Try direct parse first
            try { return JSON.parse(s); } catch {}
            // Attempt to cut to the last matching closing brace
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                const sub = s.slice(start, end + 1);
                try { return JSON.parse(sub); } catch {}
            }
            // Brace balance approach
            let depth = 0; let cut = -1;
            for (let i = 0; i < s.length; i++) {
                const c = s[i];
                if (c === '{') depth++;
                else if (c === '}') { depth--; if (depth === 0) { cut = i; break; } }
            }
            if (cut > 0) {
                const sub2 = s.slice(0, cut + 1);
                try { return JSON.parse(sub2); } catch {}
            }
            return null;
        };

        // 3) Model call (smaller max_tokens + compact input) with JSON-only response
        const baseParams = {
            model: "openai/gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `${prompts.receiptProcessor}

IMPORTANT: Respond in JSON format and use the correct language for categories based on locale ${locale}.

TASKS:
1. Classify receipt type
2. Extract merchant and date information
3. Extract ALL individual products/items
4. Translate to Spanish and normalize names
5. Categorize each product
6. Extract totals and calculate amounts

OUTPUT FORMAT (JSON):
{
  "receiptCategory": "Mercado|Transporte|Comida|Combustible|Otros",
  "merchantName": "Store/merchant name",
  "purchaseDate": "2024-01-15" or null,
  "purchaseDateRaw": "1/10/2025" or "10-01-2025" if present on the receipt,
  "currency": "USD|COP|EUR|GBP|JPY|MXN|CAD|BRL|ARS|CLP|PEN|[any ISO code]",
  "country": "NL|ES|DE|FR|BE|US|CO|etc",
  "paymentMethod": "cash|card|mobile|voucher|other",
  "cardType": "Visa|Mastercard|American Express|etc" or null,
  "totals": {
    "subtotal": 45.50,
    "tax": 3.64,
    "total": 49.14,
    "discount": 0
  },
  "vatInfo": {
    "21": {"amount": 3.64, "base": 17.33},
    "9": {"amount": 0.45, "base": 5.00}
  },
  "discountInfo": {
    "type": "member|coupon|sale|loyalty",
    "code": "VIP10|SAVE5|etc",
    "amount": 2.50,
    "reason": "Member discount|Sale price|etc"
  },
  "products": [
    {
      "name": "Normalized name in Spanish",
      "category": "Alimentos|Bebidas|Limpieza|Higiene|Farmacia|Otros",
      "quantity": 1.5,
      "unitPrice": 2.50,
      "totalPrice": 3.75,
      "weight": "1.5L|500g|2kg|etc",
      "isOrganic": true|false,
      "brand": "Coca-Cola|Jumbo|etc",
      "originalText": "Original text from receipt"
    }
  ]
}

PAYMENT METHOD EXTRACTION:
- Look for payment indicators: "CARD", "CASH", "CONTACTLESS", "MOBILE", "VOUCHER", "EFECTIVO", "TARJETA"
- Card type indicators: "VISA", "MASTERCARD", "AMERICAN EXPRESS", "AMEX", "MC", "V"
- Mobile payment: "APPLE PAY", "GOOGLE PAY", "SAMSUNG PAY", "PAYPAL"
- If multiple payments, use the primary one (usually the largest amount)

DISCOUNT EXTRACTION:
- Discount types: "MEMBER"/"SOCIO", "COUPON"/"CUPON", "SALE"/"OFERTA", "LOYALTY"/"FIDELIDAD"
- Look for discount codes: alphanumeric codes near discount amounts
- Extract discount amounts and reasons from lines with negative values or "DESCUENTO"/"DISCOUNT"
- Calculate percentage if both original and discounted prices are visible

TAX/VAT/IVA EXTRACTION (GLOBAL):
- Common tax types: VAT, IVA, GST, Sales Tax, ICMS, ISS, BTW, TVA, MWST, PST, HST
- Tax rates vary by country: 5%, 7%, 9%, 10%, 12%, 15%, 16%, 18%, 19%, 20%, 21%, 25%, etc.
- USA: Sales Tax (varies by state: 0%-10.75%)
- Canada: GST (5%), PST/HST (varies by province: 5%-15%)
- Mexico: IVA (16%, 8% border)
- Colombia: IVA (19%, 5%, 0%)
- Brazil: ICMS (varies by state: 7%-25%)
- Japan: Consumption Tax (10%, 8% reduced)
- Australia/NZ: GST (10%/15%)
- India: GST (5%, 12%, 18%, 28%)
- Extract base amount and tax amount for each rate found
- IMPORTANT: Only include tax rates with amounts > 0
- NEVER include 0% tax or rates with 0.00 amounts
- Store any tax found, regardless of country or name

COUNTRY DETECTION:
- Currency symbols: € (EU), £ (GB), $ (US/CA/AU), ¥ (JP/CN), ₹ (IN), R$ (BR), $ (MX/CO/AR)
- Language indicators: English, Spanish, Portuguese, French, German, Italian, Dutch, Japanese, Chinese
- Common chains: Walmart (US), Tesco (GB), Carrefour (FR/BR), OXXO (MX), 7-Eleven (Global)
- Phone patterns: +1 (US/CA), +44 (GB), +81 (JP), +86 (CN), +91 (IN), +55 (BR), +52 (MX)
- Tax terminology: Sales Tax (US), GST (CA/AU/IN), IVA (ES/MX/CO), ICMS (BR), VAT (EU)

PRODUCT WEIGHT/VOLUME EXTRACTION:
- Weight: "kg", "g", "gr", "gram", "kilo"
- Volume: "l", "L", "ml", "cl", "liter", "litre"
- Format examples: "1.5L", "500g", "2kg", "750ml", "33cl"
- Extract from product names or separate weight/volume lines

CRITICAL RULES:
- If text is in English or other languages, translate EVERYTHING to Spanish
- Normalize product names removing specific brands when possible
- Product categories: Alimentos, Bebidas, Limpieza, Higiene, Farmacia, Otros
- Receipt categories: Mercado, Transporte, Comida, Combustible, Otros
- Ignore non-product lines (totals, payment methods, headers, etc.)
- Use reasonable defaults if information cannot be determined
- ALWAYS extract payment method, VAT info, and discount details when available
- Country detection is CRITICAL for VAT rate validation

DATE DISAMBIGUATION (CRITICAL):
- Return purchaseDateRaw exactly as written in the receipt when possible.
- Normalize purchaseDate (YYYY-MM-DD) using country/currency/language context:
  * US/CA: prefer mm/dd or mm-dd
  * EU (e.g., NL, ES, FR, DE, BE, IT, PT): prefer dd/mm or dd-mm
  * If ambiguous (both day and month ≤ 12), choose based on country/currency first, then language
  * Avoid future dates (> 7 days ahead) and very old dates (> 2 years)

TOTALS & CURRENCY EXTRACTION - CRITICAL:
- Look for lines containing: "TOTAL", "GRAND TOTAL", "TOTAL A PAGAR", "AMOUNT DUE", "BALANCE DUE"
- Total can appear in ANY monetary format:
  * With symbols: $12.34, €12,34, £12.34, ¥1234, ₹123, ₡1234, ₦1234
  * With codes: USD 12.34, COP 1234, EUR 12,34, GBP 12.34, JPY 1234
  * Numbers only: 12.34, 1,234.56, 12 345.67, 1234567
  * European format: 1.234,56 (thousands.cents)
  * American format: 1,234.56 (thousands,cents)
- AUTO-DETECT currency from text (ISO codes, symbols, names)
- If no explicit total found, calculate: subtotal + tax - discount
- Subtotal keywords: "SUBTOTAL", "SUB TOTAL", "SUB-TOTAL"
- Tax keywords: "TAX", "IVA", "IMPUESTO", "TAXES", "GST", "VAT", "SALES TAX"
- Discount keywords: "DISCOUNT", "DESCUENTO", "DTO", "DCTO", "SAVINGS"
- ALWAYS include at least the total, estimate if necessary
- USE correct ISO currency code (USD, EUR, GBP, COP, MXN, etc.)

VALIDATION & ANOMALY DETECTION:
- VERIFY product sum matches subtotal (5% tolerance)
- VERIFY subtotal + tax - discount = total (2% tolerance)
- If calculations don't match, adjust values using best judgment:
  * Prioritize clearly visible TOTAL
  * Recalculate products if prices seem incorrect
  * If product price is abnormal (>10x average), review it
- ANOMALY DETECTION:
  * Products with price < 0.01 or > 10000: likely OCR error
  * Total < any individual product price: obvious error
  * Tax > 50% of subtotal: likely error
  * If anomalies detected, attempt correction or mark as suspicious

PRODUCT NORMALIZATION EXAMPLES:
- "Coca Cola 2L" → "Refresco de cola 2L" (category: Bebidas)
- "Heinz Ketchup" → "Salsa de tomate" (category: Alimentos)
- "Bananas" → "Bananas" (category: Alimentos)
- "Tide Detergent" → "Detergente" (category: Limpieza)
- "Milk 1 gallon" → "Leche 1 galón" (category: Alimentos)

Respond with ONLY valid JSON. No additional text, explanations, or formatting.`
                },
                { role: "user", content: compactText },
            ],
            temperature: 0.2,
            max_tokens: 1000,
            response_format: { type: "json_object" },
        };

        let completion = await client.chat.completions.create(baseParams);

        let response = completion.choices?.[0]?.message?.content?.trim() || '';
        let parsed = extractJson(response);

        // If truncated or not valid JSON, retry once with higher tokens
        const finish = completion.choices?.[0]?.finish_reason;
        if (!parsed || finish === 'length') {
            log.warn('AI unified: retrying with higher token budget', { finish });
            completion = await client.chat.completions.create({ ...baseParams, max_tokens: 1400 });
            response = completion.choices?.[0]?.message?.content?.trim() || '';
            parsed = extractJson(response);
        }

        try {
            if (!parsed) throw new Error('invalid_json');

            log.info("Receipt processed with AI (unified)", {
                receiptCategory: parsed.receiptCategory,
                productCount: parsed.products?.length || 0,
                textLength: receiptText.length,
                finishReason: finish
            });

            // Map the AI response category to internal English format
            if (parsed.receiptCategory) {
                parsed.receiptCategory = mapCategoryToInternal(parsed.receiptCategory) || 'others';
            }

            const result = {
                success: true,
                data: parsed
            };

            // 4) Store in cache for fast subsequent calls
            try { await cacheService.set(cacheKey, result, 7*24*3600); } catch {}
            return result;
        } catch (parseError) {
            log.error("Error parsing unified AI response", {
                response: response.substring(0, 500), // Log first 500 chars
                parseError: parseError.message,
                locale
            });
            return { success: false, error: "Failed to parse AI response" };
        }

    } catch (err) {
        log.error("Error en procesamiento unificado con IA:", {
            error: err.message,
            stack: err.stack,
            locale,
            textLength: receiptText?.length
        });
        return { success: false, error: err.message };
    }
}

export async function translateAndNormalizeProductName(productName) {
    try {
        const completion = await client.chat.completions.create({
            model: "openai/gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a grocery product name translator and normalizer. Your tasks:

1. If text is in English or other languages, translate to Spanish
2. Normalize product names by removing specific brands when possible
3. Use generic, common Spanish terms
4. Keep essential product information (type, presentation, size)
5. Remove irrelevant information like codes, serial numbers, etc.

Examples:
- "Coca Cola 2L" → "Refresco de cola 2L"
- "Heinz Ketchup 400g" → "Salsa de tomate 400g"
- "Milk 1 gallon" → "Leche 1 galón"
- "Bread loaf" → "Pan de molde"
- "Bananas" → "Bananas"
- "Tide Detergent" → "Detergente"
- "Chicken breast" → "Pechuga de pollo"

Respond ONLY with the normalized Spanish name. No explanations or additional text.`
                },
                { role: "user", content: productName },
            ],
            max_tokens: 50,
        });

        const normalized = completion.choices[0].message.content.trim();

        log.debug("Product name normalized", {
            original: productName,
            normalized: normalized
        });

        return normalized;
    } catch (err) {
        log.error("Error en traducción/normalización de producto:", err);
        // Fallback: basic cleanup
        return productName
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }
}

// New: Unified AI pipeline starting from processed image bytes (OCR + parsing)
export async function processReceiptWithAIFromImage(imageBuffer, locale = 'en', publicImageUrl = null) {
    log.info('processReceiptWithAIFromImage called', { locale, publicImageUrl });
    try {
        const bufHash = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
        const hash = crypto.createHash('sha256').update(bufHash).digest('hex');
        const cacheKey = `ai:receipt:image:${locale}:${hash}`;
        try {
            const cached = await cacheService.get(cacheKey);
            if (cached?.success) {
                log.info('AI image result cache hit', { locale, hash: hash.substring(0,8) });
                return cached;
            }
        } catch {}

        // Prefer public URL if provided (e.g., https://api.tallylens.app/uploads/xxx.webp)
        let imageInput;
        if (publicImageUrl) {
            imageInput = { type: 'image_url', image_url: { url: publicImageUrl } };
        } else {
            // Data URL fallback
            const b = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
            const isPng = b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47;
            const isJpg = b[0]===0xFF && b[1]===0xD8;
            const isWebp = b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b.slice(8,12).toString('utf8')==='WEBP';
            const mime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png';
            const dataUrl = `data:${mime};base64,${b.toString('base64')}`;
            imageInput = { type: 'input_image', image_url: { url: dataUrl } };
        }

        const prompts = getAIPrompts(locale);

        // Build strict JSON schema + rules for extraction (same spec as text pipeline)
        const systemPrompt = `${prompts.receiptProcessor}

IMPORTANT: Respond ONLY with valid JSON following the schema below. Do not include code fences or any extra text. All instructions are in English, and all output categories should use internal English values. Return MINIFIED JSON (single line, no spaces/newlines) to reduce length.

TASKS:
1. Classify the receipt type
2. Extract merchant and date information
3. Extract ALL individual products/items
4. Normalize product names in English (generic names; avoid brand names when possible)
5. Categorize each product using internal categories
6. Extract totals and calculate amounts

OUTPUT FORMAT (JSON - MINIMAL FIELDS ONLY):
{
  "receiptCategory": "grocery|transport|food|fuel|others",
  "merchantName": "Store/merchant name",
  "purchaseDate": "2024-01-15" or null,
  "purchaseDateRaw": "1/10/2025" or "10-01-2025" or original notation if present,
  "currency": "USD|COP|EUR|GBP|JPY|MXN|CAD|BRL|ARS|CLP|PEN|[any ISO code]",
  "country": "US|NL|ES|DE|FR|BE|CO|...",
  "paymentMethod": "cash|card|mobile|voucher|other",
  "cardType": "Visa|Mastercard|American Express|..." or null,
  "totals": {
    "subtotal": 45.50,
    "tax": 3.64,
    "total": 49.14,
    "discount": 0
  },
  "vatInfo": { "21": {"amount": 3.64, "base": 17.33} },
  "discountInfo": null,
  "products": [
    {
      "name": "Normalized generic name in English",
      "category": "food|beverages|cleaning|personal_care|pharmacy|others",
      "quantity": 1.5,
      "unitPrice": 2.50,
      "totalPrice": 3.75,
      "originalText": "Optional: include the exact line(s) used to infer quantity/price, e.g., '2 x 2,99'"
    }
  ]
}

PAYMENT METHOD EXTRACTION:
- Look for indicators: "CARD", "CASH", "CONTACTLESS", "MOBILE", "VOUCHER"
- Card type indicators: "VISA", "MASTERCARD", "AMERICAN EXPRESS", "AMEX", "MC"
- Mobile payment: "APPLE PAY", "GOOGLE PAY", "SAMSUNG PAY", "PAYPAL"
- If multiple payments, use the primary one (largest amount)

DISCOUNT EXTRACTION:
- Discount types: "MEMBER", "COUPON", "SALE", "LOYALTY"
- Extract discount amounts/codes when present; use null if unknown

TAX/VAT EXTRACTION (GLOBAL):
- Common tax types: VAT, GST, Sales Tax, ICMS, ISS, BTW, TVA, MWST, PST, HST
- Extract base and tax amount for each found rate
- IMPORTANT: Include only tax rates with amounts > 0; NEVER include 0%

COUNTRY DETECTION:
- Use signals from currency, language, known chains, phone country codes, and tax terminology

PRODUCT WEIGHT/VOLUME EXTRACTION:
- Weight: "kg", "g", "gram"; Volume: "l", "L", "ml", "cl"
- Formats: "1.5L", "500g", "2kg", "750ml", "33cl"

CRITICAL RULES:
- QUANTITY/PACK MULTIPLIERS: Parse patterns like '2 x 2,99', '2×1.09', '3 X €1,50'. If present, set quantity=numeric multiplier and unitPrice=single-unit price, totalPrice=quantity*unitPrice. These patterns may appear on the line below the product name; still infer correctly.
- Normalize product names in English (generic names; remove brand unless it’s the essence)
- Product categories must be one of: food, beverages, cleaning, personal_care, pharmacy, others
- Receipt category must be one of: grocery, transport, food, fuel, others
- Ignore non-product lines
- Use reasonable defaults; use null if truly unknown
- ALWAYS extract payment method, VAT info (cleaned), and discount details when available
- TOTALS & CURRENCY:
  * Detect currency (ISO/symbol/name)
  * If no explicit total, calculate: subtotal + tax - discount
  * Subtotal keywords: "SUBTOTAL", "SUB TOTAL", "SUB-TOTAL"
  * Tax keywords: "TAX", "GST", "VAT", "SALES TAX"
  * Discount keywords: "DISCOUNT", "SAVINGS"

DATE DISAMBIGUATION (CRITICAL):
- Return purchaseDateRaw exactly as seen on the receipt when possible (e.g., "1/10/2025", "10-01-2025").
- Normalize purchaseDate to ISO (YYYY-MM-DD) using country/currency/language context:
  * US/CA: prefer mm/dd or mm-dd
  * EU (e.g., NL, ES, FR, DE, BE, IT, PT): prefer dd/mm or dd-mm
  * If ambiguous (both day and month ≤ 12), choose based on country/currency first, then language
  * Avoid obviously future dates (> 7 days from today) and very old dates (> 2 years)
  * If still ambiguous, pick the most plausible date (not future) consistent with context

VALIDATION & ANOMALY DETECTION:
- Verify products sum ≈ subtotal (±5%)
- Verify subtotal + tax - discount ≈ total (±2%)
- Flag anomalies: unitPrice < 0.01 or > 10000; tax > 50% subtotal; total < any item

OUTPUT REQUIREMENTS:
- Return ONLY valid, MINIFIED JSON (single line, no spaces or newlines). No code fences or extra text
- Use numbers (not strings) for numeric fields; round monetary values to two decimals
- Use ISO date format (YYYY-MM-DD) when possible; otherwise null
- Use null for unknown values; you may omit optional keys (brand, weight, isOrganic, originalText) to reduce length
- Keep arrays empty if no items`;

        // JSON-only response with vision input
        const baseParams = {
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: [
                        { type: 'text', text: 'Analyze this receipt image and produce the JSON exactly as specified.' },
                        imageInput
                    ]
                }
            ],
            temperature: 0.2,
            max_tokens: 1800,
            response_format: { type: 'json_object' }
        };

        const extractJson = (txt) => {
            if (!txt) return null;
            let s = String(txt).trim();
            s = s.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            try { return JSON.parse(s); } catch {}
            const start = s.indexOf('{');
            const end = s.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                try { return JSON.parse(s.slice(start, end+1)); } catch {}
            }
            return null;
        };

        let completion;
        let response = '';
        let parsed = null;
        let finish = null;

        try {
            completion = await client.chat.completions.create(baseParams);
            finish = completion.choices?.[0]?.finish_reason;
            response = completion.choices?.[0]?.message?.content?.trim() || '';
            parsed = extractJson(response);

            const usage = completion.usage || {};
            log.debug('AI image completion received', {
                model: baseParams.model,
                finishReason: finish,
                contentLength: response.length,
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens
            });
            logger.debug('AI image completion response', {
                response: parsed
            });
        } catch (apiErr) {
            log.error('AI image completion error (primary model)', {
                model: baseParams.model,
                error: apiErr.message
            });
            return { success: false, error: apiErr.message };
        }

        if (!parsed || finish === 'length') {
            log.warn('AI image response not valid JSON or truncated; retrying with higher tokens', {
                model: baseParams.model,
                finishReason: finish,
                sample: response.slice(0, 400)
            });
            try {
                const usage = completion?.usage || {};
                const observed = usage.completion_tokens || 0;
                // Adaptive max: increase by 50–100% of observed completion or +600 baseline
                const proposed = observed > 0 ? Math.ceil(observed * 1.6) : (baseParams.max_tokens + 600);
                const adaptiveMax = Math.min(Math.max(proposed, (baseParams.max_tokens || 1800) + 400), 3200);

                log.debug('AI image adaptive max_tokens', {
                    observedCompletionTokens: observed,
                    previousMax: baseParams.max_tokens,
                    newMax: adaptiveMax
                });

                completion = await client.chat.completions.create({ ...baseParams, max_tokens: adaptiveMax });
                finish = completion.choices?.[0]?.finish_reason;
                response = completion.choices?.[0]?.message?.content?.trim() || '';
                parsed = extractJson(response);
            } catch (apiErr2) {
                log.error('AI image completion error on retry (primary model)', {
                    model: baseParams.model,
                    error: apiErr2.message
                });
            }
        }

        if (!parsed) {
            const fallbackParams = { ...baseParams, model: 'openai/gpt-4o-mini' };
            log.warn('Falling back to alternate vision model', { from: baseParams.model, to: fallbackParams.model });
            try {
                completion = await client.chat.completions.create(fallbackParams);
                finish = completion.choices?.[0]?.finish_reason;
                response = completion.choices?.[0]?.message?.content?.trim() || '';
                parsed = extractJson(response);
            } catch (apiErr3) {
                log.error('AI image completion error (fallback model)', {
                    model: fallbackParams.model,
                    error: apiErr3.message
                });
            }
        }

        if (!parsed) {
            log.error('Failed to parse AI response (image pipeline)', {
                modelTried: [baseParams.model, 'openai/gpt-4o-mini'],
                lastFinishReason: finish,
                responseSample: response.slice(0, 800)
            });
            return { success: false, error: 'Failed to parse AI response' };
        }

        // Normalize receipt category
        if (parsed.receiptCategory) {
            parsed.receiptCategory = mapCategoryToInternal(parsed.receiptCategory) || 'others';
        }

        const result = { success: true, data: parsed };
        try { await cacheService.set(cacheKey, result, 7*24*3600); } catch {}
        return result;
    } catch (err) {
        log.error('Error in AI-from-image pipeline', { error: err.message, stack: err.stack });
        return { success: false, error: err.message };
    }
}
