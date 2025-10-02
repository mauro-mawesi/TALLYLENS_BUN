import { log } from '../utils/logger.js';

/**
 * Servicio de validación y corrección de datos de recibos
 * Detecta y corrige anomalías en precios, totales y cálculos
 */

// Configuración de tolerancias
const TOLERANCES = {
    subtotalMismatch: 0.05,      // 5% de tolerancia para subtotal vs suma de productos
    totalMismatch: 0.02,          // 2% de tolerancia para total calculado
    maxPriceRatio: 10,            // Un producto no debería costar 10x más que el promedio
    minPrice: 0.01,               // Precio mínimo válido
    maxPrice: 10000,              // Precio máximo razonable para un solo producto
    maxTaxRate: 0.50,             // Tax no debería ser más del 50% del subtotal
    maxDiscountRate: 0.90,        // Descuento no debería ser más del 90%
};

/**
 * Valida y corrige los datos extraídos de un recibo
 */
export function validateAndCorrectReceiptData(data) {
    if (!data || !data.success) return data;

    log.info('Starting receipt validation', {
        itemCount: data.items?.length || 0,
        total: data.totals?.total
    });

    // Copia de trabajo
    const validated = JSON.parse(JSON.stringify(data));
    const anomalies = [];

    // 0. Normalizar fecha de compra si es ambigua
    try {
        const normalized = resolvePurchaseDate(
            data.purchaseDate,
            data.purchaseDateRaw,
            data.country,
            data.currency,
            (global?.i18n?.getLocale && global.i18n.getLocale()) || 'en'
        );
        if (normalized && normalized.dateISO && normalized.changed) {
            validated.purchaseDate = normalized.dateISO;
            validated.dateResolution = {
                method: normalized.method,
                raw: data.purchaseDateRaw || null,
                country: data.country || null
            };
        }
    } catch {}

    // 1. Validar productos individuales
    if (validated.items && validated.items.length > 0) {
        const productValidation = validateProducts(validated.items);
        validated.items = productValidation.correctedItems;
        anomalies.push(...productValidation.anomalies);
    }

    // 2. Validar y corregir totales
    if (validated.totals || validated.items?.length > 0) {
        const totalsValidation = validateTotals(
            validated.items || [],
            validated.totals || {}
        );
        validated.totals = totalsValidation.correctedTotals;
        anomalies.push(...totalsValidation.anomalies);
    }

    // 3. Validación cruzada final
    const crossValidation = performCrossValidation(validated);
    anomalies.push(...crossValidation.anomalies);

    // Agregar información de validación
    validated.validation = {
        performed: true,
        anomaliesDetected: anomalies.length,
        anomalies: anomalies,
        confidence: calculateConfidenceScore(anomalies)
    };

    if (anomalies.length > 0) {
        log.warn('Anomalies detected in receipt', {
            count: anomalies.length,
            anomalies: anomalies
        });
    }

    return validated;
}

// ======================= DATE NORMALIZATION =======================
function resolvePurchaseDate(purchaseDateISO, purchaseDateRaw, country, currency, locale) {
    const out = { dateISO: purchaseDateISO || null, changed: false, method: 'none' };
    const raw = (purchaseDateRaw || '').trim();
    if (!raw) return out;

    // Match typical numeric formats: dd/mm/yyyy or mm/dd/yyyy or with '-'
    const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (!m) return out;

    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const year = parseInt(m[3].length === 2 ? ('20' + m[3]) : m[3], 10);
    if (a < 1 || a > 31 || b < 1 || b > 31) return out;

    const euCountries = new Set(['NL','ES','FR','DE','BE','IT','PT','IE','LU','AT','FI','SE','DK','NO','PL','CZ','SK','HU','RO','BG','HR','SI','GR']);
    const isEU = (country && euCountries.has(String(country).toUpperCase())) || currency === 'EUR';
    const isUS = (country && String(country).toUpperCase() === 'US') || currency === 'USD';

    // Build candidate dates
    const pad = (n) => String(n).padStart(2,'0');
    const asDMY = [year, pad(b), pad(a)].join('-'); // dd/mm -> yyyy-mm-dd
    const asMDY = [year, pad(a), pad(b)].join('-'); // mm/dd -> yyyy-mm-dd

    // Helper: plausibility
    const today = new Date();
    const maxFutureDays = 7;
    const maxPastYears = 2;
    const isPlausible = (iso) => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return false;
        const diffDays = (d - today) / (1000*60*60*24);
        if (diffDays > maxFutureDays) return false;
        const pastYears = (today - d) / (1000*60*60*24*365);
        if (pastYears > maxPastYears) return false;
        return true;
    };

    const dmyOk = isPlausible(asDMY);
    const mdyOk = isPlausible(asMDY);

    // If not ambiguous (one component > 12), prefer the only valid interpretation
    const ambiguous = (a <= 12 && b <= 12);

    let chosen = null;
    let method = 'none';
    if (!ambiguous) {
        // If a>12 => a is day, use DMY; if b>12 => a is month, use MDY
        if (a > 12) { chosen = asDMY; method = 'by_components_dmy'; }
        else if (b > 12) { chosen = asMDY; method = 'by_components_mdy'; }
    } else {
        // Ambiguous: choose by region preference if plausible
        if (isEU && dmyOk) { chosen = asDMY; method = 'by_country_eu'; }
        else if (isUS && mdyOk) { chosen = asMDY; method = 'by_country_us'; }
        else if (dmyOk && !mdyOk) { chosen = asDMY; method = 'by_plausibility_dmy'; }
        else if (mdyOk && !dmyOk) { chosen = asMDY; method = 'by_plausibility_mdy'; }
        else if (dmyOk) { chosen = asDMY; method = 'fallback_dmy'; }
        else if (mdyOk) { chosen = asMDY; method = 'fallback_mdy'; }
    }

    if (chosen && chosen !== purchaseDateISO) {
        out.dateISO = chosen;
        out.changed = true;
        out.method = method;
    }
    return out;
}

/**
 * Valida productos individuales
 */
function validateProducts(items) {
    const anomalies = [];
    const correctedItems = [];

    // Calcular estadísticas para detección de outliers
    const prices = items.map(item => item.totalPrice || item.unitPrice || 0).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const medianPrice = getMedian(prices);

    for (const item of items) {
        let correctedItem = { ...item };
        const itemAnomalies = [];

        // Validar precio unitario
        if (correctedItem.unitPrice !== undefined) {
            if (correctedItem.unitPrice < TOLERANCES.minPrice) {
                itemAnomalies.push({
                    type: 'price_too_low',
                    field: 'unitPrice',
                    value: correctedItem.unitPrice,
                    message: `Precio unitario muy bajo: ${correctedItem.unitPrice}`
                });
                // Intentar corregir dividiendo el total por cantidad
                if (correctedItem.totalPrice && correctedItem.quantity) {
                    correctedItem.unitPrice = correctedItem.totalPrice / correctedItem.quantity;
                }
            } else if (correctedItem.unitPrice > TOLERANCES.maxPrice) {
                itemAnomalies.push({
                    type: 'price_too_high',
                    field: 'unitPrice',
                    value: correctedItem.unitPrice,
                    message: `Precio unitario muy alto: ${correctedItem.unitPrice}`
                });
                // Posible error de punto decimal
                correctedItem.unitPrice = correctedItem.unitPrice / 100;
            }
        }

        // Validar precio total
        if (correctedItem.totalPrice !== undefined) {
            // Verificar si es outlier extremo
            if (avgPrice > 0 && correctedItem.totalPrice > avgPrice * TOLERANCES.maxPriceRatio) {
                itemAnomalies.push({
                    type: 'price_outlier',
                    field: 'totalPrice',
                    value: correctedItem.totalPrice,
                    average: avgPrice,
                    message: `Precio ${correctedItem.totalPrice} es ${(correctedItem.totalPrice/avgPrice).toFixed(1)}x el promedio`
                });
            }

            // Verificar consistencia cantidad * unitPrice = totalPrice
            if (correctedItem.quantity && correctedItem.unitPrice) {
                const expectedTotal = correctedItem.quantity * correctedItem.unitPrice;
                const difference = Math.abs(expectedTotal - correctedItem.totalPrice);
                const tolerance = expectedTotal * 0.02; // 2% tolerancia

                if (difference > tolerance) {
                    itemAnomalies.push({
                        type: 'price_mismatch',
                        expected: expectedTotal,
                        actual: correctedItem.totalPrice,
                        message: `Total no coincide: ${correctedItem.quantity} × ${correctedItem.unitPrice} ≠ ${correctedItem.totalPrice}`
                    });
                    // Corregir usando el cálculo
                    correctedItem.totalPrice = expectedTotal;
                }
            }
        }

        // Validar cantidad
        if (correctedItem.quantity !== undefined) {
            if (correctedItem.quantity <= 0 || correctedItem.quantity > 1000) {
                itemAnomalies.push({
                    type: 'quantity_invalid',
                    value: correctedItem.quantity,
                    message: `Cantidad inválida: ${correctedItem.quantity}`
                });
                correctedItem.quantity = 1; // Default seguro
            }
        }

        // Si no hay totalPrice, calcularlo
        if (!correctedItem.totalPrice && correctedItem.unitPrice && correctedItem.quantity) {
            correctedItem.totalPrice = correctedItem.unitPrice * correctedItem.quantity;
        }

        if (itemAnomalies.length > 0) {
            anomalies.push({
                item: correctedItem.name || correctedItem.originalText,
                issues: itemAnomalies
            });
        }

        correctedItems.push(correctedItem);
    }

    return { correctedItems, anomalies };
}

/**
 * Valida y corrige totales
 */
function validateTotals(items, totals) {
    const anomalies = [];
    const correctedTotals = { ...totals };

    // Calcular suma de productos (a menudo BRUTO con IVA por línea)
    const itemsSum = items.reduce((sum, item) => {
        if (typeof item.totalPrice === 'number') return sum + item.totalPrice;
        if (typeof item.unitPrice === 'number' && typeof item.quantity === 'number') return sum + (item.unitPrice * item.quantity);
        if (typeof item.unitPrice === 'number') return sum + item.unitPrice;
        return sum;
    }, 0);

    // Validar subtotal considerando que itemsSum puede representar el TOTAL (líneas con IVA incluido)
    const hasSubtotal = typeof correctedTotals.subtotal === 'number';
    const hasTotal = typeof correctedTotals.total === 'number';
    const distToSubtotal = hasSubtotal ? Math.abs(itemsSum - correctedTotals.subtotal) : Number.POSITIVE_INFINITY;
    const distToTotal = hasTotal ? Math.abs(itemsSum - correctedTotals.total) : Number.POSITIVE_INFINITY;
    const preferGrossItems = distToTotal < distToSubtotal;

    if (hasSubtotal) {
        if (!preferGrossItems) {
            const tolerance = (itemsSum || 1) * TOLERANCES.subtotalMismatch;
            if (distToSubtotal > tolerance) {
                anomalies.push({
                    type: 'subtotal_mismatch',
                    calculated: itemsSum,
                    declared: correctedTotals.subtotal,
                    difference: distToSubtotal,
                    message: `Subtotal no coincide con suma de productos`
                });
                // Si la diferencia es grande, ajustar
                if (distToSubtotal > (itemsSum * 0.2)) {
                    if (typeof correctedTotals.tax === 'number' && hasTotal) {
                        correctedTotals.subtotal = correctedTotals.total - correctedTotals.tax;
                    } else {
                        correctedTotals.subtotal = itemsSum;
                    }
                }
            }
        } else {
            // itemsSum se parece más al total: no marcar mismatch de subtotal y ajustar si podemos
            if (typeof correctedTotals.tax === 'number' && hasTotal) {
                correctedTotals.subtotal = correctedTotals.total - correctedTotals.tax;
            }
        }
    } else {
        // Sin subtotal: derivar el mejor posible
        if (typeof correctedTotals.tax === 'number' && hasTotal) {
            correctedTotals.subtotal = correctedTotals.total - correctedTotals.tax;
        } else if (itemsSum > 0) {
            correctedTotals.subtotal = itemsSum;
        }
    }

    // Validar tax
    if (correctedTotals.tax && correctedTotals.subtotal) {
        const taxRate = correctedTotals.tax / correctedTotals.subtotal;
        if (taxRate > TOLERANCES.maxTaxRate) {
            anomalies.push({
                type: 'tax_too_high',
                rate: taxRate,
                tax: correctedTotals.tax,
                subtotal: correctedTotals.subtotal,
                message: `Impuesto muy alto: ${(taxRate * 100).toFixed(1)}% del subtotal`
            });
            // Corregir usando tasa típica del 19% (ajustar según país)
            correctedTotals.tax = correctedTotals.subtotal * 0.19;
        }
    }

    // Validar descuento
    if (correctedTotals.discount && correctedTotals.subtotal) {
        const discountRate = correctedTotals.discount / correctedTotals.subtotal;
        if (discountRate > TOLERANCES.maxDiscountRate) {
            anomalies.push({
                type: 'discount_too_high',
                rate: discountRate,
                discount: correctedTotals.discount,
                subtotal: correctedTotals.subtotal,
                message: `Descuento muy alto: ${(discountRate * 100).toFixed(1)}% del subtotal`
            });
            correctedTotals.discount = 0; // Mejor asumir sin descuento
        }
    }

    // Validar y corregir total
    const calculatedTotal = (correctedTotals.subtotal || itemsSum) +
                          (correctedTotals.tax || 0) -
                          (correctedTotals.discount || 0);

    if (correctedTotals.total) {
        const totalDiff = Math.abs(calculatedTotal - correctedTotals.total);
        const totalTolerance = calculatedTotal * TOLERANCES.totalMismatch;

        if (totalDiff > totalTolerance) {
            anomalies.push({
                type: 'total_mismatch',
                calculated: calculatedTotal,
                declared: correctedTotals.total,
                difference: totalDiff,
                message: `Total no coincide con cálculo: ${calculatedTotal.toFixed(2)} vs ${correctedTotals.total}`
            });

            // Si la diferencia es pequeña, ajustar tax para que cuadre
            if (totalDiff < calculatedTotal * 0.1) {
                const adjustedTax = correctedTotals.total - correctedTotals.subtotal + (correctedTotals.discount || 0);
                if (adjustedTax >= 0 && adjustedTax < correctedTotals.subtotal * 0.3) {
                    correctedTotals.tax = adjustedTax;
                }
            } else {
                // Si la diferencia es grande, confiar en el total mostrado
                correctedTotals.calculatedTotal = calculatedTotal;
            }
        }
    } else {
        correctedTotals.total = calculatedTotal;
    }

    return { correctedTotals, anomalies };
}

/**
 * Validación cruzada final
 */
function performCrossValidation(data) {
    const anomalies = [];

    // El total no puede ser menor que cualquier producto individual
    if (data.totals?.total && data.items?.length > 0) {
        const maxItemPrice = Math.max(...data.items.map(i => i.totalPrice || 0));
        if (data.totals.total < maxItemPrice) {
            anomalies.push({
                type: 'total_less_than_item',
                total: data.totals.total,
                maxItemPrice: maxItemPrice,
                message: `Total (${data.totals.total}) es menor que un producto (${maxItemPrice})`
            });
        }
    }

    // Si hay muchos items pero total muy pequeño, probable error
    if (data.items?.length > 5 && data.totals?.total) {
        const avgPerItem = data.totals.total / data.items.length;
        if (avgPerItem < 0.5) {
            anomalies.push({
                type: 'suspiciously_low_average',
                avgPerItem: avgPerItem,
                message: `Promedio por item muy bajo: ${avgPerItem.toFixed(2)}`
            });
        }
    }

    return { anomalies };
}

/**
 * Calcula mediana de un array
 */
function getMedian(numbers) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calcula score de confianza basado en anomalías
 */
function calculateConfidenceScore(anomalies) {
    if (anomalies.length === 0) return 1.0;

    // Penalizar por cada tipo de anomalía
    const penalties = {
        'total_mismatch': 0.3,
        'subtotal_mismatch': 0.2,
        'price_outlier': 0.15,
        'tax_too_high': 0.1,
        'price_mismatch': 0.1,
        'total_less_than_item': 0.4,
        'suspiciously_low_average': 0.25
    };

    let score = 1.0;
    const processedTypes = new Set();

    for (const anomaly of anomalies) {
        const type = anomaly.type || (anomaly.issues && anomaly.issues[0]?.type);
        if (type && !processedTypes.has(type)) {
            score -= (penalties[type] || 0.05);
            processedTypes.add(type);
        }
    }

    return Math.max(0, Math.min(1, score));
}

export default {
    validateAndCorrectReceiptData,
    TOLERANCES
};
