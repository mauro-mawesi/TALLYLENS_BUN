'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // First check if table exists, if not create it
        const tableExists = await queryInterface.sequelize.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipts');`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        if (!tableExists[0].exists) {
            await queryInterface.createTable('receipts', {
                id: {
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4,
                    primaryKey: true,
                    allowNull: false
                },
                user_id: {
                    type: Sequelize.UUID,
                    allowNull: false,
                    references: {
                        model: 'users',
                        key: 'id'
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE'
                },
                image_url: {
                    type: Sequelize.TEXT,
                    allowNull: false
                },
                image_thumbnail_url: {
                    type: Sequelize.TEXT,
                    allowNull: true
                },
                raw_text: {
                    type: Sequelize.TEXT,
                    allowNull: true
                },
                parsed_data: {
                    type: Sequelize.JSONB,
                    allowNull: true
                },
                category: {
                    type: Sequelize.STRING,
                    allowNull: true
                },
                amount: {
                    type: Sequelize.DECIMAL(10, 2),
                    allowNull: true
                },
                currency: {
                    type: Sequelize.STRING(3),
                    defaultValue: 'USD',
                    allowNull: false
                },
                merchant_name: {
                    type: Sequelize.STRING,
                    allowNull: true
                },
                purchase_date: {
                    type: Sequelize.DATE,
                    allowNull: true
                },
                tags: {
                    type: Sequelize.ARRAY(Sequelize.STRING),
                    defaultValue: [],
                    allowNull: false
                },
                notes: {
                    type: Sequelize.TEXT,
                    allowNull: true
                },
                is_processed: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false,
                    allowNull: false
                },
                processing_status: {
                    type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
                    defaultValue: 'pending',
                    allowNull: false
                },
                processing_error: {
                    type: Sequelize.TEXT,
                    allowNull: true
                },
                created_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
                },
                updated_at: {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
                }
            });
        } else {
            // If table exists, add new columns that might not exist
            const columns = await queryInterface.describeTable('receipts');

            if (!columns.user_id) {
                await queryInterface.addColumn('receipts', 'user_id', {
                    type: Sequelize.UUID,
                    allowNull: true, // Temporarily allow null for existing records
                    references: {
                        model: 'users',
                        key: 'id'
                    },
                    onUpdate: 'CASCADE',
                    onDelete: 'CASCADE'
                });
            }

            if (!columns.image_thumbnail_url) {
                await queryInterface.addColumn('receipts', 'image_thumbnail_url', {
                    type: Sequelize.TEXT,
                    allowNull: true
                });
            }

            if (!columns.parsed_data) {
                await queryInterface.addColumn('receipts', 'parsed_data', {
                    type: Sequelize.JSONB,
                    allowNull: true
                });
            }

            if (!columns.amount) {
                await queryInterface.addColumn('receipts', 'amount', {
                    type: Sequelize.DECIMAL(10, 2),
                    allowNull: true
                });
            }

            if (!columns.currency) {
                await queryInterface.addColumn('receipts', 'currency', {
                    type: Sequelize.STRING(3),
                    defaultValue: 'USD',
                    allowNull: false
                });
            }

            if (!columns.merchant_name) {
                await queryInterface.addColumn('receipts', 'merchant_name', {
                    type: Sequelize.STRING,
                    allowNull: true
                });
            }

            if (!columns.purchase_date) {
                await queryInterface.addColumn('receipts', 'purchase_date', {
                    type: Sequelize.DATE,
                    allowNull: true
                });
            }

            if (!columns.tags) {
                await queryInterface.addColumn('receipts', 'tags', {
                    type: Sequelize.ARRAY(Sequelize.STRING),
                    defaultValue: [],
                    allowNull: false
                });
            }

            if (!columns.notes) {
                await queryInterface.addColumn('receipts', 'notes', {
                    type: Sequelize.TEXT,
                    allowNull: true
                });
            }

            if (!columns.is_processed) {
                await queryInterface.addColumn('receipts', 'is_processed', {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false,
                    allowNull: false
                });
            }

            if (!columns.processing_status) {
                await queryInterface.addColumn('receipts', 'processing_status', {
                    type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed'),
                    defaultValue: 'pending',
                    allowNull: false
                });
            }

            if (!columns.processing_error) {
                await queryInterface.addColumn('receipts', 'processing_error', {
                    type: Sequelize.TEXT,
                    allowNull: true
                });
            }

            if (!columns.updated_at) {
                await queryInterface.addColumn('receipts', 'updated_at', {
                    type: Sequelize.DATE,
                    allowNull: false,
                    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
                });
            }
        }

        // Add indexes
        await queryInterface.addIndex('receipts', ['user_id']);
        await queryInterface.addIndex('receipts', ['category']);
        await queryInterface.addIndex('receipts', ['created_at']);
        await queryInterface.addIndex('receipts', ['purchase_date']);
        await queryInterface.addIndex('receipts', ['processing_status']);
        await queryInterface.addIndex('receipts', ['is_processed']);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('receipts');
    }
};