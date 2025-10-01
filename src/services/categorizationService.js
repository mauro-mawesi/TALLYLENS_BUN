import OpenAI from "openai";
import { log } from "../utils/logger.js";
import { getAIPrompts } from "../config/i18n.js";
import { mapCategoryToInternal } from "../utils/categoryMapper.js";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

export async function categorizeReceipt(text, locale = 'en') {
    try {
        const prompts = getAIPrompts(locale);

        const completion = await client.chat.completions.create({
            model: "openai/gpt-4o-mini",
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
        console.log('processReceiptWithAI called with locale:', locale, 'text length:', receiptText?.length);

        const prompts = getAIPrompts(locale);

        const completion = await client.chat.completions.create({
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
                { role: "user", content: receiptText },
            ],
            max_tokens: 1500,
        });

        const response = completion.choices[0].message.content.trim();

        try {
            const parsed = JSON.parse(response);

            log.info("Receipt processed with AI (unified)", {
                receiptCategory: parsed.receiptCategory,
                productCount: parsed.products?.length || 0,
                textLength: receiptText.length,
                tokensUsed: "~1500"
            });

            // Map the AI response category to internal English format
            if (parsed.receiptCategory) {
                parsed.receiptCategory = mapCategoryToInternal(parsed.receiptCategory) || 'others';
            }

            return {
                success: true,
                data: parsed
            };
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
