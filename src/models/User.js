import { DataTypes } from 'sequelize';
import bcrypt from 'bcryptjs';
import sequelize from '../config/db.js';
import config from '../config/environment.js';

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: {
                msg: 'Please provide a valid email'
            }
        },
        set(value) {
            this.setDataValue('email', value.toLowerCase());
        }
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            len: {
                args: [3, 30],
                msg: 'Username must be between 3 and 30 characters'
            },
            isAlphanumeric: {
                msg: 'Username can only contain letters and numbers'
            }
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: {
                args: [8, 100],
                msg: 'Password must be at least 8 characters long'
            }
        }
    },
    firstName: {
        field: 'first_name',
        type: DataTypes.STRING,
        allowNull: true
    },
    lastName: {
        field: 'last_name',
        type: DataTypes.STRING,
        allowNull: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    role: {
        type: DataTypes.ENUM('user', 'admin', 'moderator'),
        defaultValue: 'user',
        allowNull: false
    },
    isActive: {
        field: 'is_active',
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
    },
    emailVerified: {
        field: 'email_verified',
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    emailVerificationToken: {
        field: 'email_verification_token',
        type: DataTypes.STRING,
        allowNull: true
    },
    passwordResetToken: {
        field: 'password_reset_token',
        type: DataTypes.STRING,
        allowNull: true
    },
    passwordResetExpires: {
        field: 'password_reset_expires',
        type: DataTypes.DATE,
        allowNull: true
    },
    lastLogin: {
        field: 'last_login',
        type: DataTypes.DATE,
        allowNull: true
    },
    loginAttempts: {
        field: 'login_attempts',
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
    },
    lockedUntil: {
        field: 'locked_until',
        type: DataTypes.DATE,
        allowNull: true
    },
    preferredLanguage: {
        field: 'preferred_language',
        type: DataTypes.STRING(5),
        allowNull: true,
        defaultValue: 'en',
        validate: {
            isIn: {
                args: [['en', 'es', 'nl']],
                msg: 'Language must be one of: en, es, nl'
            }
        }
    }
}, {
    tableName: 'users',
    timestamps: true,
    underscored: true,
    hooks: {
        beforeSave: async (user) => {
            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, config.security.bcrypt.rounds);
            }

            // Auto-generate name from firstName and lastName
            if (user.changed('firstName') || user.changed('lastName') || !user.name) {
                const parts = [];
                if (user.firstName) parts.push(user.firstName);
                if (user.lastName) parts.push(user.lastName);
                user.name = parts.length > 0 ? parts.join(' ') : user.username || user.email.split('@')[0];
            }
        }
    }
});

// Instance methods
User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

User.prototype.isLocked = function() {
    return this.lockedUntil && this.lockedUntil > Date.now();
};

User.prototype.incrementLoginAttempts = async function() {
    // Reset attempts if lock has expired
    if (this.lockedUntil && this.lockedUntil < Date.now()) {
        return await this.update({
            loginAttempts: 1,
            lockedUntil: null
        });
    }

    const updates = { loginAttempts: this.loginAttempts + 1 };
    const maxAttempts = 5;
    const lockTime = 2 * 60 * 60 * 1000; // 2 hours

    if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked()) {
        updates.lockedUntil = new Date(Date.now() + lockTime);
    }

    return await this.update(updates);
};

User.prototype.resetLoginAttempts = async function() {
    return await this.update({
        loginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date()
    });
};

User.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    delete values.password;
    delete values.emailVerificationToken;
    delete values.passwordResetToken;
    delete values.passwordResetExpires;
    delete values.loginAttempts;
    delete values.lockedUntil;
    return values;
};

// Class methods
User.findByEmail = async function(email) {
    return await this.findOne({ where: { email: email.toLowerCase() } });
};

User.findByUsername = async function(username) {
    return await this.findOne({ where: { username } });
};

export default User;