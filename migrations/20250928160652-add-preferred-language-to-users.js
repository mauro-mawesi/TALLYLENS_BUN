'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'preferred_language', {
      type: Sequelize.STRING(5),
      allowNull: true,
      defaultValue: 'en',
      validate: {
        isIn: [['en', 'es', 'nl']]
      }
    });

    // Set default language for existing users
    await queryInterface.sequelize.query(
      "UPDATE users SET preferred_language = 'en' WHERE preferred_language IS NULL"
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'preferred_language');
  }
};