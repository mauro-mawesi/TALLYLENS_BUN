import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const SearchHistory = sequelize.define('SearchHistory', {
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
    query: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    resultsCount: {
        field: 'results_count',
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    }
}, {
    tableName: 'search_history',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['user_id', 'created_at'] },
        { fields: ['user_id', 'query'] }
    ]
});

// Get recent searches for a user
SearchHistory.getRecentSearches = async function(userId, limit = 10) {
    return await this.findAll({
        where: { userId },
        order: [['created_at', 'DESC']],
        limit,
        attributes: ['query', 'resultsCount', 'createdAt'],
        group: ['query', 'results_count', 'created_at'],
        raw: true
    });
};

// Get popular searches for a user
SearchHistory.getPopularSearches = async function(userId, limit = 10) {
    const results = await sequelize.query(`
        SELECT
            query,
            COUNT(*) as search_count,
            MAX(created_at) as last_searched
        FROM search_history
        WHERE user_id = :userId
        GROUP BY query
        ORDER BY search_count DESC, last_searched DESC
        LIMIT :limit
    `, {
        replacements: { userId, limit },
        type: sequelize.QueryTypes.SELECT
    });

    return results;
};

// Add search to history (or update if recent duplicate)
SearchHistory.addSearch = async function(userId, query, resultsCount) {
    // Check if same query was searched in last hour
    const recentSearch = await this.findOne({
        where: {
            userId,
            query,
            createdAt: {
                [sequelize.Sequelize.Op.gte]: new Date(Date.now() - 3600000) // Last hour
            }
        },
        order: [['created_at', 'DESC']]
    });

    if (recentSearch) {
        // Update existing recent search
        return await recentSearch.update({
            resultsCount,
            createdAt: new Date() // Bump to top
        });
    }

    // Create new search history entry
    return await this.create({
        userId,
        query,
        resultsCount
    });
};

export default SearchHistory;
