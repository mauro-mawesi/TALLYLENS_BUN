import { asyncHandler } from '../utils/errors.js';
import { log } from '../utils/logger.js';
import Receipt from '../models/Receipt.js';
import { extractReceiptData } from '../services/ocrService.js';
import { processReceiptItems } from '../services/receiptItemService.js';
import { addSignedUrlsToReceipt } from '../utils/urlSigner.js';

/**
 * Batch sync endpoint para sincronización offline-first
 * Recibe un array de recibos del cliente y los crea/actualiza
 * Conflict resolution: last-write-wins basado en updatedAt
 */
export const syncReceipts = asyncHandler(async (req, res) => {
    const { receipts } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(receipts) || receipts.length === 0) {
        return res.status(400).json({
            status: 'error',
            message: req.t('validation.invalid_receipts_array')
        });
    }

    // Validar límite de batch (máximo 50 recibos por request)
    if (receipts.length > 50) {
        return res.status(400).json({
            status: 'error',
            message: req.t('validation.batch_limit_exceeded', { max: 50 })
        });
    }

    log.info('Batch sync started', {
        userId,
        receiptCount: receipts.length
    });

    const synced = [];
    const failed = [];

    // Procesar cada recibo
    for (const receiptData of receipts) {
        try {
            const { localId, serverId, imageUrl, createdAt, updatedAt } = receiptData;

            // Validar que tenga localId o serverId
            if (!localId && !serverId) {
                failed.push({
                    localId: null,
                    error: 'Missing localId or serverId'
                });
                continue;
            }

            // Validar que tenga imageUrl
            if (!imageUrl) {
                failed.push({
                    localId,
                    error: 'Missing imageUrl'
                });
                continue;
            }

            // Buscar recibo existente por serverId (si existe) o crear nuevo
            let receipt = null;
            if (serverId) {
                receipt = await Receipt.findOne({
                    where: {
                        id: serverId,
                        userId
                    }
                });
            }

            // Si no existe, buscar por localId en metadata (futura implementación)
            // Por ahora, asumimos que si no tiene serverId, es un nuevo recibo

            if (receipt) {
                // CONFLICT RESOLUTION: Last-write-wins
                // Solo actualizar si el cliente tiene una versión más reciente
                const clientUpdatedAt = new Date(updatedAt);
                const serverUpdatedAt = new Date(receipt.updatedAt);

                if (clientUpdatedAt > serverUpdatedAt) {
                    // Actualizar recibo existente
                    await receipt.update({
                        imageUrl,
                        merchantName: receiptData.merchantName || receipt.merchantName,
                        category: receiptData.category || receipt.category,
                        amount: receiptData.amount !== undefined ? receiptData.amount : receipt.amount,
                        currency: receiptData.currency || receipt.currency,
                        purchaseDate: receiptData.purchaseDate || receipt.purchaseDate,
                        notes: receiptData.notes !== undefined ? receiptData.notes : receipt.notes,
                        updatedAt: clientUpdatedAt
                    });

                    log.info('Receipt updated via sync', {
                        receiptId: receipt.id,
                        localId,
                        userId
                    });
                } else {
                    log.debug('Server version is newer, skipping update', {
                        receiptId: receipt.id,
                        localId
                    });
                }
            } else {
                // Crear nuevo recibo
                receipt = await Receipt.create({
                    userId,
                    imageUrl,
                    merchantName: receiptData.merchantName,
                    category: receiptData.category,
                    amount: receiptData.amount,
                    currency: receiptData.currency || 'USD',
                    purchaseDate: receiptData.purchaseDate,
                    notes: receiptData.notes,
                    processingStatus: 'pending',
                    isProcessed: false,
                    createdAt: createdAt ? new Date(createdAt) : new Date(),
                    updatedAt: updatedAt ? new Date(updatedAt) : new Date()
                });

                log.info('New receipt created via sync', {
                    receiptId: receipt.id,
                    localId,
                    userId
                });

                // Si el cliente ya procesó la imagen (processedByMLKit), iniciar procesamiento
                if (receiptData.processedByMLKit && receiptData.imageUrl) {
                    // Procesar en background (no bloquear sync)
                    processReceiptInBackground(receipt.id, receiptData.imageUrl, userId, req.locale).catch(err => {
                        log.error('Background processing error', {
                            receiptId: receipt.id,
                            error: err.message
                        });
                    });
                }
            }

            // Agregar a lista de sincronizados
            const receiptJson = receipt.toJSON();
            synced.push({
                localId,
                id: receipt.id,
                serverId: receipt.id,
                imageUrl: receipt.imageUrl,
                merchantName: receipt.merchantName,
                category: receipt.category,
                amount: receipt.amount,
                currency: receipt.currency,
                purchaseDate: receipt.purchaseDate,
                notes: receipt.notes,
                createdAt: receipt.createdAt,
                updatedAt: receipt.updatedAt
            });

        } catch (error) {
            log.error('Error syncing individual receipt', {
                localId: receiptData.localId,
                error: error.message
            });

            failed.push({
                localId: receiptData.localId,
                error: error.message
            });
        }
    }

    log.info('Batch sync completed', {
        userId,
        total: receipts.length,
        synced: synced.length,
        failed: failed.length
    });

    res.json({
        status: 'success',
        message: req.t('sync.batch_completed', { synced: synced.length, failed: failed.length }),
        data: {
            synced,
            failed,
            stats: {
                total: receipts.length,
                succeeded: synced.length,
                failed: failed.length
            }
        }
    });
});

/**
 * Procesa un recibo en background sin bloquear el sync
 */
async function processReceiptInBackground(receiptId, imageUrl, userId, locale = 'en') {
    try {
        const receipt = await Receipt.findByPk(receiptId);
        if (!receipt) return;

        // Marcar como processing
        await receipt.update({ processingStatus: 'processing' });

        // Extraer datos con OCR/AI
        const extractedData = await extractReceiptData(imageUrl, locale, {
            skipEnhancement: true,
            processedByMLKit: true
        });

        if (extractedData.success) {
            // Actualizar recibo con datos extraídos
            await receipt.update({
                rawText: extractedData.rawText || '',
                merchantName: extractedData.merchantName || receipt.merchantName,
                purchaseDate: extractedData.purchaseDate || receipt.purchaseDate,
                amount: extractedData.totals?.total || receipt.amount,
                currency: extractedData.currency || receipt.currency,
                category: extractedData.category || receipt.category,
                paymentMethod: extractedData.paymentMethod,
                cardType: extractedData.cardType,
                vatInfo: extractedData.vatInfo,
                discountInfo: extractedData.discountInfo,
                country: extractedData.country,
                parsedData: {
                    totals: extractedData.totals,
                    items: extractedData.items,
                    extractionMethod: extractedData.extractionMethod
                },
                processingStatus: 'completed',
                isProcessed: true
            });

            // Procesar items del recibo (firma correcta: receiptId, userId, items, currency, transaction, locale)
            if (extractedData.items && extractedData.items.length > 0) {
                await processReceiptItems(
                    receipt.id,
                    userId,
                    extractedData.items,
                    extractedData.currency,
                    null,
                    locale
                );
            }

            log.info('Receipt processed successfully in background', {
                receiptId,
                userId
            });
        } else {
            await receipt.update({
                processingStatus: 'failed',
                processingError: extractedData.error || 'Unknown error'
            });

            log.warn('Receipt processing failed in background', {
                receiptId,
                error: extractedData.error
            });
        }
    } catch (error) {
        log.error('Background receipt processing error', {
            receiptId,
            error: error.message
        });

        // Intentar marcar como failed
        try {
            const receipt = await Receipt.findByPk(receiptId);
            if (receipt) {
                await receipt.update({
                    processingStatus: 'failed',
                    processingError: error.message
                });
            }
        } catch (updateError) {
            log.error('Failed to update receipt status', {
                receiptId,
                error: updateError.message
            });
        }
    }
}

/**
 * Obtiene el estado de sincronización del usuario
 * Útil para mostrar badges y estadísticas
 */
export const getSyncStatus = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Contar recibos por estado de procesamiento
    const processingStats = await Receipt.findAll({
        where: { userId },
        attributes: [
            'processingStatus',
            [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        group: ['processingStatus']
    });

    const stats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
    };

    processingStats.forEach(stat => {
        stats[stat.processingStatus] = parseInt(stat.get('count'));
    });

    res.json({
        status: 'success',
        data: {
            stats,
            totalReceipts: Object.values(stats).reduce((sum, count) => sum + count, 0)
        }
    });
});
