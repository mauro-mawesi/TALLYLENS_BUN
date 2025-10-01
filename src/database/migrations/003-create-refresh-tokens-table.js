'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('refresh_tokens', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true,
                allowNull: false
            },
            token: {
                type: Sequelize.STRING(500),
                allowNull: false,
                unique: true
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
            device_info: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            ip_address: {
                type: Sequelize.STRING,
                allowNull: true
            },
            expires_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            revoked: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
                allowNull: false
            },
            revoked_at: {
                type: Sequelize.DATE,
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

        // Add indexes
        await queryInterface.addIndex('refresh_tokens', ['token']);
        await queryInterface.addIndex('refresh_tokens', ['user_id']);
        await queryInterface.addIndex('refresh_tokens', ['expires_at']);
        await queryInterface.addIndex('refresh_tokens', ['revoked']);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('refresh_tokens');
    }
};