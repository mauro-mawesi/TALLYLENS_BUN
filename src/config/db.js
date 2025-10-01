import { Sequelize } from "sequelize";
import config from "./environment.js";

// Para certificados self-signed, desactivar verificación SSL de Node.js
if (config.database.ssl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const sequelize = new Sequelize(config.database.url, {
    dialect: "postgres",
    dialectOptions: config.database.ssl ? {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    } : {},
    logging: config.database.logging,
    // FORZAR underscored para que funcione con Bun
    define: {
        underscored: true,
        freezeTableName: false,
        timestamps: true,
        paranoid: false
    },
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

// HACK para Bun: Forzar que todos los modelos usen underscored
const originalDefine = sequelize.define;
sequelize.define = function(modelName, attributes, options = {}) {
    // Forzar underscored en todas las definiciones
    options.underscored = true;
    return originalDefine.call(this, modelName, attributes, options);
};

export default sequelize;
