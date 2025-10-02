#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../src/config/db.js';
import Receipt from '../src/models/Receipt.js';
import ReceiptItem from '../src/models/ReceiptItem.js';
import Product from '../src/models/Product.js';
import { extractReceiptData } from '../src/services/ocrService.js';
import { categorizeReceipt } from '../src/services/categorizationService.js';
import { processReceiptItems } from '../src/services/receiptItemService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const UPLOADS_DIR = 'uploads';
// Prefer public base URL so AI provider can fetch the image (e.g., via Cloudflare Tunnel)
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://api.tallylens.app';
const BASE_URL = `${PUBLIC_BASE.replace(/\/$/, '')}/uploads`;
const DEFAULT_USER_ID = 'eac1ccc7-3daa-4034-b0a7-06f885a0766b'; // Your user ID
const DEFAULT_LOCALE = 'es';

console.log('🚀 Starting receipt reprocessing script...');

async function cleanDatabase() {
    console.log('🗑️  Cleaning existing data...');

    const transaction = await sequelize.transaction();

    try {
        // Delete in order to respect foreign key constraints
        await ReceiptItem.destroy({ where: {}, transaction });
        console.log('   ✅ Deleted all receipt items');

        await Receipt.destroy({ where: {}, transaction });
        console.log('   ✅ Deleted all receipts');

        await Product.destroy({ where: {}, transaction });
        console.log('   ✅ Deleted all products');

        // Reset sequences if using PostgreSQL
        await sequelize.query('ALTER SEQUENCE IF EXISTS receipts_id_seq RESTART WITH 1', { transaction });
        await sequelize.query('ALTER SEQUENCE IF EXISTS receipt_items_id_seq RESTART WITH 1', { transaction });
        await sequelize.query('ALTER SEQUENCE IF EXISTS products_id_seq RESTART WITH 1', { transaction });

        await transaction.commit();
        console.log('🧹 Database cleaned successfully!');
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

async function getImageFiles() {
    console.log(`📁 Scanning for images in: ${UPLOADS_DIR}`);

    if (!fs.existsSync(UPLOADS_DIR)) {
        throw new Error(`Uploads directory not found: ${UPLOADS_DIR}`);
    }

    const files = fs.readdirSync(UPLOADS_DIR);
    const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });

    console.log(`📷 Found ${imageFiles.length} image files`);
    imageFiles.forEach(file => console.log(`   - ${file}`));

    return imageFiles.sort(); // Process in alphabetical order
}

async function processReceipt(imageFile, index, total) {
    const imageUrl = `${BASE_URL}/${imageFile}`;
    console.log(`\n📋 Processing receipt ${index + 1}/${total}: ${imageFile}`);

    const transaction = await sequelize.transaction();

    try {
        // Extract data from receipt image
        console.log('   🔍 Extracting text and analyzing with AI...');
        const ocrResult = await extractReceiptData(imageUrl, DEFAULT_LOCALE);

        if (!ocrResult.success) {
            console.log(`   ❌ OCR failed: ${ocrResult.error}`);
            await transaction.rollback();
            return { success: false, error: ocrResult.error };
        }

        console.log(`   📝 Extracted text (${ocrResult.rawText?.length || 0} chars)`);
        console.log(`   🛍️  Found ${ocrResult.items?.length || 0} items`);

        // Log enhanced extraction info
        if (ocrResult.paymentMethod) {
            console.log(`   💳 Payment: ${ocrResult.paymentMethod}${ocrResult.cardType ? ` (${ocrResult.cardType})` : ''}`);
        }
        if (ocrResult.country) {
            console.log(`   🌍 Country: ${ocrResult.country}`);
        }
        if (ocrResult.vatInfo && Object.keys(ocrResult.vatInfo).length > 0) {
            console.log(`   📊 VAT rates: ${Object.keys(ocrResult.vatInfo).join('%, ')}%`);
        }
        if (ocrResult.discountInfo?.amount) {
            console.log(`   💰 Discount: ${ocrResult.discountInfo.amount} (${ocrResult.discountInfo.type || 'unknown'})`);
        }

        // Categorize receipt
        let finalCategory = ocrResult.category;
        if (!finalCategory && ocrResult.rawText) {
            console.log('   🏷️  Categorizing receipt...');
            finalCategory = await categorizeReceipt(ocrResult.rawText, DEFAULT_LOCALE);
        }

        console.log(`   📂 Category: ${finalCategory}`);

        // Generate proper content hash using the normalized data
        const contentHash = Receipt.generateContentHash(ocrResult);

        // Create receipt record
        const receiptData = {
            userId: DEFAULT_USER_ID,
            imageUrl,
            rawText: ocrResult.rawText,
            parsedData: {
                merchantName: ocrResult.merchantName,
                purchaseDate: ocrResult.purchaseDate,
                totals: ocrResult.totals,
                currency: ocrResult.currency,
                itemCount: ocrResult.items?.length || 0,
                validation: ocrResult.validation,
                extractionMethod: ocrResult.extractionMethod,
                paymentMethod: ocrResult.paymentMethod,
                cardType: ocrResult.cardType,
                vatInfo: ocrResult.vatInfo,
                discountInfo: ocrResult.discountInfo
            },
            category: finalCategory,
            merchantName: ocrResult.merchantName,
            purchaseDate: ocrResult.purchaseDate ? new Date(ocrResult.purchaseDate) : null,
            amount: ocrResult.totals?.total || null,
            currency: ocrResult.currency || 'USD',
            notes: `Reprocessed from ${imageFile}`,
            processingStatus: 'processing',
            paymentMethod: ocrResult.paymentMethod || null,
            cardType: ocrResult.cardType ? ocrResult.cardType.toUpperCase() : null,
            vatInfo: ocrResult.vatInfo || null,
            discountInfo: ocrResult.discountInfo || null,
            country: ocrResult.country ? ocrResult.country.toUpperCase() : null,
            contentHash
        };

        const receipt = await Receipt.create(receiptData, { transaction });
        console.log(`   ✅ Receipt created: ${receipt.id}`);

        // Process items if this is a grocery receipt and has items
        if (finalCategory === 'grocery' && ocrResult.items && ocrResult.items.length > 0) {
            console.log(`   🛒 Processing ${ocrResult.items.length} items...`);

            const processedItems = await processReceiptItems(
                receipt.id,
                ocrResult.items,
                ocrResult.currency,
                transaction,
                DEFAULT_LOCALE
            );

            console.log(`   ✅ Created ${processedItems.length} receipt items`);
            console.log(`   🆕 Created ${processedItems.filter(p => p.wasNewProduct).length} new products`);

            // Log items for verification
            processedItems.forEach((item, idx) => {
                console.log(`      ${idx + 1}. ${item.product.name} (${item.product.category}) - $${item.receiptItem.unitPrice}`);
            });
        }

        // Log validation warnings if any
        if (ocrResult.validation?.anomaliesDetected > 0) {
            console.log(`   ⚠️  ${ocrResult.validation.anomaliesDetected} anomalies detected`);
            ocrResult.validation.anomalies.forEach(anomaly => {
                console.log(`      - ${anomaly.message || anomaly.type}`);
            });
        }

        // Mark receipt as processed
        await receipt.update({
            processingStatus: 'completed',
            isProcessed: true
        }, { transaction });

        await transaction.commit();

        const result = {
            success: true,
            receiptId: receipt.id,
            itemCount: ocrResult.items?.length || 0,
            category: finalCategory,
            merchant: ocrResult.merchantName,
            total: ocrResult.totals?.total,
            currency: ocrResult.currency
        };

        console.log(`   🎉 Successfully processed receipt: ${receipt.id}`);
        return result;

    } catch (error) {
        await transaction.rollback();
        console.log(`   ❌ Error processing receipt: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function generateSummaryReport(results) {
    console.log('\n📊 PROCESSING SUMMARY REPORT');
    console.log('=' .repeat(50));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`✅ Successfully processed: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    console.log(`📊 Total processed: ${results.length}`);

    if (successful.length > 0) {
        console.log('\n🏷️  CATEGORIES:');
        const categoryCount = {};
        successful.forEach(result => {
            categoryCount[result.category] = (categoryCount[result.category] || 0) + 1;
        });
        Object.entries(categoryCount).forEach(([category, count]) => {
            console.log(`   ${category}: ${count}`);
        });

        console.log('\n💰 CURRENCY BREAKDOWN:');
        const currencyCount = {};
        successful.forEach(result => {
            if (result.currency) {
                currencyCount[result.currency] = (currencyCount[result.currency] || 0) + 1;
            }
        });
        Object.entries(currencyCount).forEach(([currency, count]) => {
            console.log(`   ${currency}: ${count}`);
        });

        const totalItems = successful.reduce((sum, result) => sum + (result.itemCount || 0), 0);
        console.log(`\n🛍️  TOTAL ITEMS CREATED: ${totalItems}`);
    }

    if (failed.length > 0) {
        console.log('\n❌ FAILED RECEIPTS:');
        failed.forEach((result, idx) => {
            console.log(`   ${idx + 1}. Error: ${result.error}`);
        });
    }

    // Get final database stats
    try {
        const receiptsCount = await Receipt.count();
        const itemsCount = await ReceiptItem.count();
        const productsCount = await Product.count();

        console.log('\n🗄️  FINAL DATABASE STATS:');
        console.log(`   Receipts: ${receiptsCount}`);
        console.log(`   Receipt Items: ${itemsCount}`);
        console.log(`   Unique Products: ${productsCount}`);
    } catch (error) {
        console.log(`   ⚠️  Could not get database stats: ${error.message}`);
    }
}

async function main() {
    try {
        console.log('🔗 Connecting to database...');
        await sequelize.authenticate();
        console.log('✅ Database connected successfully');

        // Step 1: Clean existing data
        await cleanDatabase();

        // Step 2: Get all image files
        const imageFiles = await getImageFiles();

        if (imageFiles.length === 0) {
            console.log('⚠️  No image files found to process');
            return;
        }

        // Step 3: Process each receipt
        console.log(`\n🔄 Processing ${imageFiles.length} receipts...`);
        const results = [];

        for (let i = 0; i < imageFiles.length; i++) {
            console.log(imageFiles[i]);
            const result = await processReceipt(imageFiles[i], i, imageFiles.length);
            results.push(result);

            // Small delay to avoid overwhelming the AI API
            if (i < imageFiles.length - 1) {
                console.log('   ⏱️  Waiting 2 seconds...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Step 4: Generate summary report
        await generateSummaryReport(results);

        console.log('\n🎉 Receipt reprocessing completed successfully!');

    } catch (error) {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    } finally {
        await sequelize.close();
        console.log('🔐 Database connection closed');
    }
}

// Handle script termination gracefully
process.on('SIGINT', async () => {
    console.log('\n⏹️  Script interrupted by user');
    await sequelize.close();
    process.exit(0);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await sequelize.close();
    process.exit(1);
});

// Run the script
main();
