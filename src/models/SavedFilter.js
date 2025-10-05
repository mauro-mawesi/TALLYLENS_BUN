import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const SavedFilter = sequelize.define('SavedFilter', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    userId: {
        field: 'user_id',
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            len: {
                args: [1, 255],
                msg: 'Filter name must be between 1 and 255 characters'
            }
        }
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    filters: {
        type: DataTypes.JSONB,
        allowNull: false,
        validate: {
            isValidFilters(value) {
                if (typeof value !== 'object' || value === null) {
                    throw new Error('Filters must be a valid object');
                }
                // At least one filter must be present
                const validKeys = ['category', 'dateFrom', 'dateTo', 'minAmount', 'maxAmount', 'merchant', 'tags'];
                const hasValidFilter = validKeys.some(key => value[key] !== undefined);
                if (!hasValidFilter) {
                    throw new Error('At least one filter must be specified');
                }
            }
        }
    },
    isActive: {
        field: 'is_active',
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
    },
    useCount: {
        field: 'use_count',
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    }
}, {
    tableName: 'saved_filters',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['user_id', 'is_active'] },
        { fields: ['user_id', 'name'], unique: true }
    ]
});

// Get user's saved filters
SavedFilter.getUserFilters = async function(userId, activeOnly = true) {
    const where = { userId };
    if (activeOnly) {
        where.isActive = true;
    }

    return await this.findAll({
        where,
        order: [['use_count', 'DESC'], ['created_at', 'DESC']]
    });
};

// Increment use count
SavedFilter.prototype.incrementUseCount = async function() {
    return await this.update({
        useCount: this.useCount + 1
    });
};

export default SavedFilter;
