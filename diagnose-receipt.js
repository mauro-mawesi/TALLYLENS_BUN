#!/usr/bin/env node

import { diagnoseReceiptProcessing } from './src/utils/receiptDiagnostics.js';

// Obtener URL de imagen desde argumentos de línea de comandos
const imageUrl = process.argv[2];

if (!imageUrl) {
    console.log('Uso: node diagnose-receipt.js <URL_de_imagen>');
    console.log('');
    console.log('Ejemplo:');
    console.log('  node diagnose-receipt.js http://localhost:3000/uploads/receipt.jpg');
    console.log('  node diagnose-receipt.js https://ejemplo.com/recibo.png');
    process.exit(1);
}

console.log('Iniciando diagnóstico de recibo...\n');

diagnoseReceiptProcessing(imageUrl)
    .then((result) => {
        if (result) {
            console.log('\n=== DIAGNÓSTICO COMPLETADO ===');
            if (!result.totals?.total) {
                console.log('\n⚠️  PROBLEMA IDENTIFICADO: No se detectó el total');
                console.log('Posibles causas:');
                console.log('- El formato del total no coincide con los patrones esperados');
                console.log('- La palabra "total" no está al inicio de la línea');
                console.log('- El formato de moneda es diferente al esperado');
                console.log('- El OCR no leyó correctamente esa sección');
            } else {
                console.log(`\n✅ Total detectado correctamente: ${result.totals.total}`);
            }
        }
    })
    .catch((error) => {
        console.error('\n❌ Error durante el diagnóstico:', error.message);
    });