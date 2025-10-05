import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';
import path from 'path';

dotenv.config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  }
});

const userId = 'eac1ccc7-3daa-4034-b0a7-06f885a0766b';

async function migrateImageUrls() {
  try {
    // Find the correct table name
    const [tables] = await sequelize.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ILIKE '%receipt%'`
    );

    console.log('Available tables:', tables);

    // Extract table name - Sequelize returns array of objects
    const tableName = tables.length > 0 ? (tables[0].table_name || tables[0]) : 'receipts';
    console.log(`Using table: ${tableName}\n`);

    // Get all receipts for this user
    const [receipts] = await sequelize.query(
      `SELECT id, image_url FROM ${tableName} WHERE user_id = ?`,
      { replacements: [userId] }
    );

    console.log(`Found ${receipts.length} receipts to migrate`);

    for (const receipt of receipts) {
      const oldUrl = receipt.image_url;

      // Extract filename from old URL
      // Format could be: http://host/uploads/filename.jpg or just filename.jpg
      let filename;
      if (oldUrl.includes('/uploads/')) {
        filename = path.basename(new URL(oldUrl).pathname);
      } else if (oldUrl.includes('/')) {
        filename = path.basename(oldUrl);
      } else {
        filename = oldUrl;
      }

      // New relative path format: userId/receipts/filename
      const newRelativePath = `${userId}/receipts/${filename}`;

      // Update database
      await sequelize.query(
        `UPDATE ${tableName} SET image_url = ? WHERE id = ?`,
        { replacements: [newRelativePath, receipt.id] }
      );

      console.log(`✓ Updated receipt ${receipt.id}: ${filename} -> ${newRelativePath}`);
    }

    console.log(`\n✅ Successfully migrated ${receipts.length} receipts`);
  } catch (error) {
    console.error('❌ Error migrating image URLs:', error);
  } finally {
    await sequelize.close();
  }
}

migrateImageUrls();
