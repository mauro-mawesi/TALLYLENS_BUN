// Google Vision OCR removed: unified AI-from-image pipeline only
import fs from "fs";
import path from "path";
import url from "url";
import { log } from "../utils/logger.js";
import { processReceiptWithAIFromImage } from "./categorizationService.js";
import { validateAndCorrectReceiptData } from "./receiptValidationService.js";
import imageEnhancementService from "./imageEnhancementService.js";
import cacheService from "./cacheService.js";

// No Vision client

// Clean VAT info to remove 0% rates or rates with 0 amounts
function cleanVatInfo(vatInfo) {
    if (!vatInfo || typeof vatInfo !== 'object') {
        return null;
    }

    const cleaned = {};

    Object.entries(vatInfo).forEach(([rate, data]) => {
        // Skip 0% rate or rates with 0 amount/base
        const rateNum = parseFloat(rate);
        const amount = parseFloat(data?.amount || 0);
        const base = parseFloat(data?.base || 0);

        // Only include if rate > 0 and either amount or base > 0
        if (rateNum > 0 && (amount > 0 || base > 0)) {
            cleaned[rate] = {
                amount: amount,
                base: base
            };
        }
    });

    // Return null if no valid VAT rates remain
    return Object.keys(cleaned).length > 0 ? cleaned : null;
}

async function callLocalOcrViaProcessor(fileName) {
    const baseUrl = process.env.DOCUMENT_PROCESSOR_URL || 'http://document-processor:5000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
        const resp = await fetch(`${baseUrl}/ocr-fallback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, preferProcessed: true }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`ocr-fallback failed: ${resp.status} ${t}`);
        }
        const data = await resp.json();
        return data?.ocr || { text: '', words: [] };
    } catch (e) {
        clearTimeout(timeoutId);
        log.warn('Local OCR (processor) failed', { error: e.message });
        return { text: '', words: [] };
    }
}

function isBackendUploads(imageUrl) {
    try {
        const p = url.parse(imageUrl).pathname || '';
        return p.includes('/uploads/');
    } catch { return false; }
}

function avgConfidence(words) {
    if (!Array.isArray(words) || words.length === 0) return 0;
    const vals = words.map(w => (typeof w.conf === 'number' ? w.conf : 0));
    return vals.reduce((a,b)=>a+b,0) / vals.length;
}

export async function extractTextFromImage() {
    throw new Error('OCR is disabled. Use AI-from-image unified pipeline.');
}

export async function extractReceiptData(imageUrl, locale = 'en', options = {}) {
    try {
        const { skipEnhancement = false, source = null, processedByMLKit = false } = options || {};
        // 1) Load file and produce processed image (deskew/crop/orient/enhance)
        let imageBytes;
        let filePath;
        let fileName;
        if (imageUrl.includes('/uploads/')) {
            fileName = path.basename(url.parse(imageUrl).pathname);
            filePath = path.resolve('uploads', fileName);
            imageBytes = fs.readFileSync(filePath);
        } else {
            const resp = await fetch(imageUrl);
            imageBytes = Buffer.from(await resp.arrayBuffer());
        }
        let processedImage;
        let processedImageResult = null;

        if (skipEnhancement) {
            // Skip any enhancement/cropping/orientation when image was already processed by ML Kit
            log.info('Skipping enhancement due to processedByMLKit flag', { source, processedByMLKit });
            processedImage = imageBytes;
        } else {
            const enhancementOptions = {};
            if (fileName) enhancementOptions.fileName = fileName;
            processedImageResult = await imageEnhancementService.enhanceReceiptImage(imageBytes, enhancementOptions);
            processedImage = (processedImageResult && processedImageResult.buffer) ? processedImageResult.buffer : processedImageResult;
        }

        // Build public URL for the processed image if available (prefer PUBLIC_BASE_URL if set)
        let publicImageUrl = null;
        try {
            const base = new URL(imageUrl);
            const publicBase = process.env.PUBLIC_BASE_URL || base.origin;
            if (!skipEnhancement) {
                if (processedImageResult && processedImageResult.processedFileName) {
                    publicImageUrl = `${publicBase.replace(/\/$/, '')}/uploads/${processedImageResult.processedFileName}`;
                } else if (fileName) {
                    const outName = `${Date.now()}-ai_processed.webp`;
                    const outPath = path.resolve('uploads', outName);
                    await fs.promises.writeFile(outPath, processedImage);
                    publicImageUrl = `${publicBase.replace(/\/$/, '')}/uploads/${outName}`;
                }
            } else {
                // When skipping enhancement, prefer original URL so the model sees exactly ML Kit output
                publicImageUrl = imageUrl;
            }
        } catch (e) {
            log.warn('Could not build publicImageUrl for AI vision', { error: e.message });
        }

        // 2) Unified AI directly from processed image (OCR+parsing in one step). No OCR fallbacks.
        log.info('Processing receipt with AI from image');
        const aiResult = await processReceiptWithAIFromImage(processedImage, locale, publicImageUrl);
        if (!aiResult.success) {
            return { success: false, error: aiResult.error || 'AI image pipeline failed' };
        }

        if (aiResult.success && aiResult.data) {
            // IA procesó exitosamente el recibo
            const aiData = aiResult.data;

            // Clean VAT info - remove 0% rates or rates with 0 amounts
            const cleanedVatInfo = cleanVatInfo(aiData.vatInfo);

            const aiExtracted = {
                success: true,
                rawText: '',
                merchantName: aiData.merchantName,
                purchaseDate: aiData.purchaseDate,
                purchaseDateRaw: aiData.purchaseDateRaw,
                items: aiData.products || [],
                totals: aiData.totals || {},
                currency: aiData.currency || 'USD',
                category: aiData.receiptCategory,
                paymentMethod: aiData.paymentMethod,
                cardType: aiData.cardType,
                vatInfo: cleanedVatInfo,
                discountInfo: aiData.discountInfo,
                country: aiData.country,
                extractionMethod: 'ai-unified-image'
            };

            // Aplicar validación y corrección
            log.info("Validating receipt data", {
                itemCount: aiExtracted.items.length,
                total: aiExtracted.totals?.total
            });

            return validateAndCorrectReceiptData(aiExtracted);
        }
    } catch (error) {
        log.error("Error extrayendo datos del recibo:", error);
        return {
            success: false,
            error: error.message,
            rawText: ""
        };
    }
}

function parseReceiptText(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    const result = {
        merchantName: extractMerchantName(lines),
        purchaseDate: extractPurchaseDate(lines),
        items: extractItems(lines),
        totals: extractTotals(lines),
        currency: extractCurrency(lines) || 'USD'
    };

    return result;
}

function extractMerchantName(lines) {
    // Buscar en las primeras líneas por nombres de tiendas conocidas
    const knownStores = [
        'walmart', 'target', 'costco', 'sams', 'kroger', 'safeway', 'publix',
        'home depot', 'lowes', 'best buy', 'amazon', 'cvs', 'walgreens',
        'éxito', 'carulla', 'jumbo', 'olimpica', 'metro', 'makro'
    ];

    for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i].toLowerCase();
        for (const store of knownStores) {
            if (line.includes(store)) {
                return lines[i];
            }
        }
    }

    // Si no encuentra tienda conocida, retorna la primera línea que parece un nombre
    for (let i = 0; i < Math.min(3, lines.length); i++) {
        const line = lines[i];
        if (line.length > 3 && !line.match(/^\d+/) && !line.includes('$')) {
            return line;
        }
    }

    return null;
}

function extractPurchaseDate(lines) {
    const datePatterns = [
        /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
        /(\d{1,2}-\d{1,2}-\d{2,4})/,
        /(\d{2,4}-\d{1,2}-\d{1,2})/,
        /(\d{1,2}\s+\w+\s+\d{2,4})/
    ];

    for (const line of lines) {
        for (const pattern of datePatterns) {
            const match = line.match(pattern);
            if (match) {
                const dateStr = match[1];
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }
        }
    }

    return null;
}

function extractItems(lines) {
    const items = [];
    const itemPatterns = [
        // Patrón: PRODUCTO CANTIDAD $PRECIO
        /^(.+?)\s+(\d+(?:\.\d+)?)\s*\$(\d+(?:\.\d{2})?)/,
        // Patrón: PRODUCTO $PRECIO
        /^(.+?)\s+\$(\d+(?:\.\d{2})?)/,
        // Patrón con @ (precio unitario): PRODUCTO QTY @ $UNITPRICE = $TOTAL
        /^(.+?)\s+(\d+(?:\.\d+)?)\s*@\s*\$(\d+(?:\.\d{2})?)\s*=?\s*\$(\d+(?:\.\d{2})?)/
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Saltar líneas que claramente no son productos
        if (shouldSkipLine(line)) {
            continue;
        }

        for (const pattern of itemPatterns) {
            const match = line.match(pattern);
            if (match) {
                let item;

                if (match.length === 4) { // Patrón básico con cantidad
                    item = {
                        name: cleanProductName(match[1]),
                        quantity: parseFloat(match[2]) || 1,
                        unitPrice: parseFloat(match[3]),
                        totalPrice: parseFloat(match[3]) * (parseFloat(match[2]) || 1),
                        originalText: line,
                        position: items.length
                    };
                } else if (match.length === 3) { // Patrón sin cantidad explícita
                    item = {
                        name: cleanProductName(match[1]),
                        quantity: 1,
                        unitPrice: parseFloat(match[2]),
                        totalPrice: parseFloat(match[2]),
                        originalText: line,
                        position: items.length
                    };
                } else if (match.length === 5) { // Patrón con @ y total
                    item = {
                        name: cleanProductName(match[1]),
                        quantity: parseFloat(match[2]) || 1,
                        unitPrice: parseFloat(match[3]),
                        totalPrice: parseFloat(match[4]),
                        originalText: line,
                        position: items.length
                    };
                }

                if (item && item.name.length > 1 && item.unitPrice > 0) {
                    items.push(item);
                    break;
                }
            }
        }
    }

    return items;
}

function shouldSkipLine(line) {
    const skipPatterns = [
        /^(total|subtotal|tax|iva|descuento|discount)/i,
        /^(gracias|thank you|visa|mastercard|cash|efectivo)/i,
        /^(receipt|recibo|invoice|factura)/i,
        /^\*+/,
        /^-+/,
        /^=+/,
        /^\d{4}-\d{2}-\d{2}/,
        /^(store|tienda|sucursal)/i
    ];

    return skipPatterns.some(pattern => pattern.test(line)) ||
           line.length < 3 ||
           /^\d+$/.test(line);
}

function cleanProductName(name) {
    return name
        .replace(/^\d+\s*/, '') // Remover números al inicio
        .replace(/\s+$/, '') // Remover espacios al final
        .replace(/^[\*\-\+]\s*/, '') // Remover caracteres especiales al inicio
        .trim();
}

function extractTotals(lines) {
    const totals = {};

    // Patrones universales para cualquier formato monetario
    const currencyPatterns = [
        // Símbolo de moneda seguido de número: $12.34, €12,34, £12.34, ₡1234, ¥1234
        /[^\w\s]\s*(\d{1,10}(?:[,.\s]?\d{3})*(?:[.,]\d{1,4})?)/g,
        // Código de moneda seguido de número: USD 12.34, COP 1234, EUR 12,34, BTC 0.001
        /[A-Z]{3,4}\s+(\d{1,10}(?:[,.\s]?\d{3})*(?:[.,]\d{1,4})?)/g,
        // Número seguido de código: 12.34 USD, 1234 COP, 12,34 EUR
        /(\d{1,10}(?:[,.\s]?\d{3})*(?:[.,]\d{1,4})?)\s+[A-Z]{3,4}/g,
        // Solo números con formato monetario: 12.34, 1,234.56, 12 345.67
        /(\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,4})?)/g,
        // Números grandes sin separadores: 12345, 123456
        /(\d{4,10})/g
    ];

    for (const line of lines) {
        const lowerLine = line.toLowerCase().trim();

        // Buscar subtotal con patrones más flexibles
        if (/(subtotal|sub-total|sub total)/i.test(line)) {
            const value = extractMonetaryValue(line, currencyPatterns);
            if (value > 0) {
                totals.subtotal = value;
            }
        }

        // Buscar tax/IVA con patrones mejorados
        if (/(tax|iva|impuesto|taxes)/i.test(line)) {
            const value = extractMonetaryValue(line, currencyPatterns);
            if (value >= 0) {
                totals.tax = value;
            }
        }

        // Buscar total con patrones más amplios
        if (/(^total|total\s*$|total\s*:|^gran total|^total general|^total a pagar)/i.test(line)) {
            const value = extractMonetaryValue(line, currencyPatterns);
            if (value > 0) {
                totals.total = value;
            }
        }

        // Buscar descuento
        if (/(discount|descuento|dto|dcto)/i.test(line)) {
            const value = extractMonetaryValue(line, currencyPatterns);
            if (value >= 0) {
                totals.discount = value;
            }
        }

        // Buscar líneas que tengan formato de total al final (ej: "TOTAL PAGAR: $45.67")
        if (/(total|pagar|pay|amount due)/i.test(line) && !totals.total) {
            const value = extractMonetaryValue(line, currencyPatterns);
            if (value > 0) {
                totals.total = value;
            }
        }
    }

    // Si no encontró total, intentar calcular desde subtotal + tax
    if (!totals.total && totals.subtotal) {
        const tax = totals.tax || 0;
        const discount = totals.discount || 0;
        totals.total = totals.subtotal + tax - discount;
    }

    return totals;
}

// Función universal para extraer valores monetarios de cualquier moneda
function extractMonetaryValue(line, patterns) {
    const allMatches = [];

    // Buscar todos los valores monetarios en la línea
    for (const pattern of patterns) {
        pattern.lastIndex = 0; // Reset regex state
        let match;
        while ((match = pattern.exec(line)) !== null) {
            const rawValue = match[1];
            if (rawValue) {
                const normalizedValue = normalizeMonetaryValue(rawValue);
                if (normalizedValue > 0) {
                    allMatches.push(normalizedValue);
                }
            }
        }
    }

    if (allMatches.length === 0) return 0;

    // Si hay múltiples valores, tomar el más grande (generalmente es el total)
    return Math.max(...allMatches);
}

// Normaliza cualquier formato monetario a número decimal
function normalizeMonetaryValue(rawValue) {
    if (!rawValue) return 0;

    // Limpiar el valor: remover caracteres no numéricos excepto puntos y comas
    let cleaned = rawValue.toString().replace(/[^\d,.-]/g, '');

    // Casos especiales para diferentes formatos:

    // Formato europeo: 1.234,56 → 1234.56
    if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Formato con espacios: 12 345.67 → 12345.67
    else if (/^\d{1,3}(\s\d{3})*[.,]\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(/\s/g, '').replace(',', '.');
    }
    // Formato americano con comas: 1,234.56 → 1234.56
    else if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '');
    }
    // Solo comas como separador de miles: 1,234 → 1234
    else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '');
    }
    // Solo puntos como separador de miles: 1.234 → 1234
    else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '');
    }
    // Números simples: mantener como están

    const value = parseFloat(cleaned);
    return isNaN(value) ? 0 : value;
}

function extractCurrency(lines) {
    const text = lines.join(' ').toUpperCase();

    // Mapeo de símbolos y códigos de moneda más completo
    const currencyMap = {
        // Códigos ISO comunes
        'USD': 'USD', 'DOLLAR': 'USD', 'DOLLARS': 'USD',
        'EUR': 'EUR', 'EURO': 'EUR', 'EUROS': 'EUR',
        'GBP': 'GBP', 'POUND': 'GBP', 'POUNDS': 'GBP',
        'COP': 'COP', 'PESO': 'COP', 'PESOS': 'COP',
        'MXN': 'MXN', 'MEXICAN': 'MXN',
        'CAD': 'CAD', 'CANADIAN': 'CAD',
        'JPY': 'JPY', 'YEN': 'JPY',
        'CNY': 'CNY', 'YUAN': 'CNY',
        'INR': 'INR', 'RUPEE': 'INR', 'RUPEES': 'INR',
        'BRL': 'BRL', 'REAL': 'BRL', 'REAIS': 'BRL',
        'ARS': 'ARS', 'ARGENTINE': 'ARS',
        'CLP': 'CLP', 'CHILEAN': 'CLP',
        'PEN': 'PEN', 'SOL': 'PEN', 'SOLES': 'PEN',
        'CRC': 'CRC', 'COLON': 'CRC', 'COLONES': 'CRC',
        'GTQ': 'GTQ', 'QUETZAL': 'GTQ', 'QUETZALES': 'GTQ',
        'HNL': 'HNL', 'LEMPIRA': 'HNL',
        'NIO': 'NIO', 'CORDOBA': 'NIO',
        'PAB': 'PAB', 'BALBOA': 'PAB',
        'DOP': 'DOP', 'DOMINICAN': 'DOP',
        'BOB': 'BOB', 'BOLIVIANO': 'BOB',
        'UYU': 'UYU', 'URUGUAYAN': 'UYU',
        'PYG': 'PYG', 'GUARANI': 'PYG'
    };

    // Buscar códigos de moneda explícitos en el texto
    for (const [key, currency] of Object.entries(currencyMap)) {
        if (text.includes(key)) {
            return currency;
        }
    }

    // Detectar por símbolos comunes
    if (text.includes('$')) {
        // Determinar si es USD, COP, MXN, etc. por contexto
        if (text.includes('COP') || text.includes('PESO')) return 'COP';
        if (text.includes('MXN') || text.includes('MEXICAN')) return 'MXN';
        if (text.includes('CAD') || text.includes('CANADIAN')) return 'CAD';
        if (text.includes('ARS') || text.includes('ARGENTINE')) return 'ARS';
        return 'USD'; // Default para $
    }

    if (text.includes('€')) return 'EUR';
    if (text.includes('£')) return 'GBP';
    if (text.includes('¥')) return 'JPY';
    if (text.includes('₹')) return 'INR';
    if (text.includes('₡')) return 'CRC';
    if (text.includes('₦')) return 'NGN';
    if (text.includes('₩')) return 'KRW';
    if (text.includes('₪')) return 'ILS';
    if (text.includes('₨')) return 'PKR';
    if (text.includes('₽')) return 'RUB';
    if (text.includes('₴')) return 'UAH';

    // Si no encuentra nada específico, intentar detectar por contexto geográfico
    // Esto podría mejorarse con el IP del usuario o configuración
    return 'USD'; // Default universal
}
