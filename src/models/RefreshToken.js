import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const RefreshToken = sequelize.define('RefreshToken', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    token: {
        type: DataTypes.STRING(500),
        allowNull: false,
        unique: true
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
    deviceInfo: {
        field: 'device_info',
        type: DataTypes.JSONB,
        allowNull: true
    },
    ipAddress: {
        field: 'ip_address',
        type: DataTypes.STRING,
        allowNull: true
    },
    expiresAt: {
        field: 'expires_at',
        type: DataTypes.DATE,
        allowNull: false
    },
    revoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    revokedAt: {
        field: 'revoked_at',
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'refresh_tokens',
    timestamps: true,
    underscored: true
});

// Instance methods
RefreshToken.prototype.isExpired = function() {
    return this.expiresAt < new Date();
};

RefreshToken.prototype.isValid = function() {
    return !this.revoked && !this.isExpired();
};

RefreshToken.prototype.revoke = async function() {
    return await this.update({
        revoked: true,
        revokedAt: new Date()
    });
};

// Class methods
RefreshToken.revokeAllUserTokens = async function(userId) {
    return await this.update(
        {
            revoked: true,
            revokedAt: new Date()
        },
        {
            where: {
                userId,
                revoked: false
            }
        }
    );
};

RefreshToken.cleanupExpired = async function() {
    return await this.destroy({
        where: {
            expiresAt: {
                [Op.lt]: new Date()
            }
        }
    });
};

export default RefreshToken;