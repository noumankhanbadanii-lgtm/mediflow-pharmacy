import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const pharmacyState = sqliteTable('pharmacy_state', {
  storeId: text('store_id').primaryKey(),
  version: integer('version').notNull().default(0),
  data: text('data').notNull(),
});
