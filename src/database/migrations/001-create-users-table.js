'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('users', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true,
                allowNull: false
            },
            email: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true,
                validate: {
                    isEmail: true
                }
            },
            username: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            password: {
                type: Sequelize.STRING,
                allowNull: false
            },
            first_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            last_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            role: {
                type: Sequelize.ENUM('user', 'admin', 'moderator'),
                defaultValue: 'user',
                allowNull: false
            },
            is_active: {
                type: Sequelize.BOOLEAN,
                defaultValue: true,
                allowNull: false
            },
            email_verified: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
                allowNull: false
            },
            email_verification_token: {
                type: Sequelize.STRING,
                allowNull: true
            },
            password_reset_token: {
                type: Sequelize.STRING,
                allowNull: true
            },
            password_reset_expires: {
                type: Sequelize.DATE,
                allowNull: true
            },
            last_login: {
                type: Sequelize.DATE,
                allowNull: true
            },
            login_attempts: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            locked_until: {
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
        await queryInterface.addIndex('users', ['email']);
        await queryInterface.addIndex('users', ['username']);
        await queryInterface.addIndex('users', ['role']);
        await queryInterface.addIndex('users', ['is_active']);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('users');
    }
};