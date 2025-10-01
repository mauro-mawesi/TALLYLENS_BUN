'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add content_hash column to receipts table
    await queryInterface.addColumn('receipts', 'content_hash', {
      type: Sequelize.STRING(64),
      allowNull: true,
      comment: 'SHA-256 hash of normalized receipt content for duplicate detection'
    });

    // Add index for content_hash
    await queryInterface.addIndex('receipts', ['content_hash'], {
      name: 'receipts_content_hash_idx'
    });

    // Add unique composite index for user_id and content_hash
    await queryInterface.addIndex('receipts', ['user_id', 'content_hash'], {
      name: 'receipts_user_content_hash_unique_idx',
      unique: true
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove indexes first
    await queryInterface.removeIndex('receipts', 'receipts_user_content_hash_unique_idx');
    await queryInterface.removeIndex('receipts', 'receipts_content_hash_idx');

    // Remove column
    await queryInterface.removeColumn('receipts', 'content_hash');
  }
};