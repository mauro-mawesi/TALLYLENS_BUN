import config from './environment.js';

const dbConfig = {
    development: {
        url: config.database.url,
        dialect: 'postgres',
        dialectOptions: {
            ssl: config.database.ssl ? {
                require: true,
                rejectUnauthorized: false
            } : false
        },
        logging: config.database.logging ? console.log : false,
        define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true
        }
    },
    test: {
        url: process.env.TEST_DATABASE_URL || config.database.url,
        dialect: 'postgres',
        logging: false,
        define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true
        }
    },
    production: {
        url: config.database.url,
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        },
        logging: false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        },
        define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true
        }
    }
};

export default dbConfig[config.env || 'development'];