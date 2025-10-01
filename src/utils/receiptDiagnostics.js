import { extractReceiptData } from '../services/ocrService.js';
import { processReceiptWithAI } from '../services/categorizationService.js';
import { log } from './logger.js';

/**
 * Diagnóstico completo de procesamiento de recibos
 * Útil para debuggear por qué no se detectan totales u otros datos
 */
export async function diagnoseReceiptProcessing(imageUrl) {
    console.log('\n=== DIAGNÓSTICO DE PROCESAMIENTO DE RECIBO ===\n');
    console.log(`Imagen: ${imageUrl}\n`);

    try {
        // Paso 1: Extraer texto OCR
        console.log('1. Extrayendo texto con OCR...');
        const { extractTextFromImage } = await import('../services/ocrService.js');
        const rawText = await extractTextFromImage(imageUrl);

        if (!rawText) {
            console.log('❌ ERROR: No se pudo extraer texto de la imagen');
            return;
        }

        console.log('✅ Texto extraído:');
        console.log('-------------------');
        console.log(rawText);
        console.log('-------------------\n');

        // Paso 2: Procesar con parser básico
        console.log('2. Procesando con parser básico (regex)...');
        const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        // Importar funciones internas manualmente para diagnóstico
        const basicTotals = extractTotalsDebug(lines);
        const basicMerchant = extractMerchantDebug(lines);
        const basicDate = extractDateDebug(lines);
        const basicCurrency = extractCurrencyDebug(lines);

        console.log('Resultados del parser básico:');
        console.log(`- Comercio: ${basicMerchant || 'No detectado'}`);
        console.log(`- Fecha: ${basicDate || 'No detectada'}`);
        console.log(`- Moneda: ${basicCurrency || 'No detectada'}`);
        console.log(`- Totales:`, basicTotals);
        console.log('');

        // Paso 3: Procesar con IA unificada
        console.log('3. Procesando con IA unificada...');
        const aiResult = await processReceiptWithAI(rawText);

        if (aiResult.success) {
            console.log('✅ IA procesó exitosamente:');
            console.log(`- Categoría: ${aiResult.data.receiptCategory}`);
            console.log(`- Comercio: ${aiResult.data.merchantName}`);
            console.log(`- Fecha: ${aiResult.data.purchaseDate}`);
            console.log(`- Moneda: ${aiResult.data.currency}`);
            console.log(`- Totales:`, aiResult.data.totals);
            console.log(`- Productos encontrados: ${aiResult.data.products?.length || 0}`);
        } else {
            console.log('❌ Error en IA:', aiResult.error);
        }
        console.log('');

        // Paso 4: Resultado final del sistema
        console.log('4. Resultado final del sistema...');
        const finalResult = await extractReceiptData(imageUrl);

        console.log('✅ Resultado final:');
        console.log(`- Éxito: ${finalResult.success}`);
        console.log(`- Método: ${finalResult.extractionMethod}`);
        console.log(`- Comercio: ${finalResult.merchantName}`);
        console.log(`- Fecha: ${finalResult.purchaseDate}`);
        console.log(`- Moneda: ${finalResult.currency}`);
        console.log(`- Total: ${finalResult.totals?.total || 'No detectado'}`);
        console.log(`- Subtotal: ${finalResult.totals?.subtotal || 'No detectado'}`);
        console.log(`- Impuestos: ${finalResult.totals?.tax || 'No detectado'}`);
        console.log(`- Items: ${finalResult.items?.length || 0}`);

        // Mostrar validación
        if (finalResult.validation) {
            console.log('');
            console.log('5. VALIDACIÓN Y CORRECCIONES:');
            console.log(`- Anomalías detectadas: ${finalResult.validation.anomaliesDetected}`);
            console.log(`- Nivel de confianza: ${(finalResult.validation.confidence * 100).toFixed(1)}%`);

            if (finalResult.validation.anomaliesDetected > 0) {
                console.log('- Problemas encontrados:');
                finalResult.validation.anomalies.forEach((anomaly, index) => {
                    if (anomaly.item) {
                        console.log(`  ${index + 1}. Producto "${anomaly.item}":`);
                        anomaly.issues.forEach(issue => {
                            console.log(`     ⚠️ ${issue.message}`);
                        });
                    } else {
                        console.log(`  ${index + 1}. ${anomaly.message || anomaly.type}`);
                        if (anomaly.calculated !== undefined && anomaly.declared !== undefined) {
                            console.log(`     Calculado: ${anomaly.calculated.toFixed(2)} vs Declarado: ${anomaly.declared.toFixed(2)}`);
                        }
                    }
                });
            } else {
                console.log('✅ No se detectaron anomalías');
            }
        }

        return finalResult;

    } catch (error) {
        console.log('❌ ERROR en diagnóstico:', error.message);
        console.log(error.stack);
    }
}

// Funciones de debug para parser básico
function extractTotalsDebug(lines) {
    const totals = {};
    // Usar los mismos patrones universales del sistema principal
    const currencyPatterns = [
        /[^\w\s]\s*(\d{1,10}(?:[,.\s]?\d{3})*(?:[.,]\d{1,4})?)/g,
        /[A-Z]{3,4}\s+(\d{1,10}(?:[,.\s]?\d{3})*(?:[.,]\d{1,4})?)/g,
        /(\d{1,10}(?:[,.\s]?\d{3})*(?:[.,]\d{1,4})?)\s+[A-Z]{3,4}/g,
        /(\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,4})?)/g,
        /(\d{4,10})/g
    ];

    console.log('   Analizando líneas para totales:');

    for (const line of lines) {
        // Debug: mostrar líneas que contienen palabras clave
        if (/(total|subtotal|tax|iva|discount|descuento)/i.test(line)) {
            console.log(`   → "${line}"`);

            if (/(^total|total\s*$|total\s*:|^gran total|^total general|^total a pagar)/i.test(line)) {
                const allMatches = [];

                for (const pattern of currencyPatterns) {
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(line)) !== null) {
                        const rawValue = match[1];
                        if (rawValue) {
                            const normalizedValue = normalizeMonetaryValueDebug(rawValue);
                            if (normalizedValue > 0) {
                                allMatches.push(normalizedValue);
                                console.log(`     💰 Valor encontrado: "${rawValue}" → ${normalizedValue}`);
                            }
                        }
                    }
                }

                if (allMatches.length > 0) {
                    totals.total = Math.max(...allMatches);
                    console.log(`     ✅ Total final: ${totals.total}`);
                }
            }
        }
    }

    return totals;
}

function extractMerchantDebug(lines) {
    const knownStores = [
        'walmart', 'target', 'costco', 'sams', 'kroger', 'safeway', 'publix',
        'home depot', 'lowes', 'best buy', 'amazon', 'cvs', 'walgreens',
        'éxito', 'carulla', 'jumbo', 'olimpica', 'metro', 'makro'
    ];

    console.log('   Analizando comercio en primeras líneas:');
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        console.log(`   ${i+1}. "${lines[i]}"`);
        const line = lines[i].toLowerCase();
        for (const store of knownStores) {
            if (line.includes(store)) {
                console.log(`     ✅ Comercio conocido encontrado: ${store}`);
                return lines[i];
            }
        }
    }
    console.log('     ❌ No se encontró comercio conocido');
    return null;
}

function extractDateDebug(lines) {
    const datePatterns = [
        /(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})/,
        /(\\d{1,2}-\\d{1,2}-\\d{2,4})/,
        /(\\d{2,4}-\\d{1,2}-\\d{1,2})/,
        /(\\d{1,2}\\s+\\w+\\s+\\d{2,4})/
    ];

    console.log('   Buscando fechas en líneas...');
    for (const line of lines.slice(0, 10)) {
        for (const pattern of datePatterns) {
            const match = line.match(pattern);
            if (match) {
                console.log(`     ✅ Fecha encontrada en "${line}": ${match[1]}`);
                return match[1];
            }
        }
    }
    console.log('     ❌ No se encontró fecha');
    return null;
}

function extractCurrencyDebug(lines) {
    const text = lines.join(' ');
    console.log('   Analizando moneda en texto completo...');

    if (text.includes('$') && (text.includes('USD') || text.includes('dollar'))) {
        console.log('     ✅ USD detectado');
        return 'USD';
    }
    if (text.includes('COP') || text.includes('peso')) {
        console.log('     ✅ COP detectado');
        return 'COP';
    }
    console.log('     ⚠️  Moneda no detectada, usando USD por defecto');
    return 'USD';
}

// Función de normalización para debug (copia de la función principal)
function normalizeMonetaryValueDebug(rawValue) {
    if (!rawValue) return 0;

    console.log(`       🔍 Normalizando: "${rawValue}"`);

    // Limpiar el valor: remover caracteres no numéricos excepto puntos y comas
    let cleaned = rawValue.toString().replace(/[^\d,.-]/g, '');
    console.log(`       🧹 Limpiado: "${cleaned}"`);

    // Casos especiales para diferentes formatos:

    // Formato europeo: 1.234,56 → 1234.56
    if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        console.log(`       🇪🇺 Formato europeo: "${cleaned}"`);
    }
    // Formato con espacios: 12 345.67 → 12345.67
    else if (/^\d{1,3}(\s\d{3})*[.,]\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(/\s/g, '').replace(',', '.');
        console.log(`       📍 Formato con espacios: "${cleaned}"`);
    }
    // Formato americano con comas: 1,234.56 → 1234.56
    else if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '');
        console.log(`       🇺🇸 Formato americano: "${cleaned}"`);
    }
    // Solo comas como separador de miles: 1,234 → 1234
    else if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '');
        console.log(`       📊 Solo comas miles: "${cleaned}"`);
    }
    // Solo puntos como separador de miles: 1.234 → 1234
    else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '');
        console.log(`       📈 Solo puntos miles: "${cleaned}"`);
    }
    // Números simples: mantener como están
    else {
        console.log(`       ✏️  Número simple: "${cleaned}"`);
    }

    const value = parseFloat(cleaned);
    const result = isNaN(value) ? 0 : value;
    console.log(`       ➡️  Resultado final: ${result}`);
    return result;
}