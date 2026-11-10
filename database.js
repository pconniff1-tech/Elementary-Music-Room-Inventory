// database.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 1. Open or create the database file
const dataDirectory = app.isPackaged ? app.getPath('userData') : __dirname;
const dbPath = path.join(dataDirectory, 'inventory.db');
const db = new Database(dbPath);

// Enable Foreign Key support so tables can link together securely
db.pragma('foreign_keys = ON');

// 2. Table 1: The General Catalog Models (unchanged)
db.exec(`
  CREATE TABLE IF NOT EXISTS instrument_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT
  )
`);

// Table: the editable list of categories shown in the dropdowns
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )
`);

// Seed the category list once, on first run
const checkCategories = db.prepare("SELECT COUNT(*) as count FROM categories").get();
if (checkCategories.count === 0) {
  const insertCategory = db.prepare('INSERT INTO categories (name) VALUES (?)');
  const defaultCategories = [
    "Percussion", "Strings", "Audio Accessories", "Movement",
    "Picture Books", "Keyboards", "Woodwind", "Other"
  ];
  defaultCategories.forEach(name => insertCategory.run(name));
  console.log("Default categories seeded!");
}

// 3. Table 2: The Physical Itemized Assets (RESTRUCTURED)
db.exec(`
  CREATE TABLE IF NOT EXISTS individual_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER,
    asset_tag_number TEXT NOT NULL, -- e.g., "15" - the physical tag number, unique per model only
    asset_tag_name TEXT,                   -- e.g., "Ukulele" - for display purposes
    resource_title TEXT NOT NULL DEFAULT '',
    purchase_date TEXT,
    status TEXT DEFAULT 'Good',
    repair_notes TEXT DEFAULT '',
    FOREIGN KEY(model_id) REFERENCES instrument_models(id) ON DELETE CASCADE,
    UNIQUE(model_id, asset_tag_number)
  )
`);

console.log("Itemized Database initialized successfully!");

// Backup function
function backupDatabase() {
  const backupPath = path.join(dataDirectory, 'inventory_backup.db');
  try {
    fs.copyFileSync(dbPath, backupPath);
    console.log("Database backup created successfully!");
    return true;
  } catch (error) {
    console.error("Failed to create database backup:", error);
    return false;
  }
}

// Migration function for new schema
function migrateToNewSchema() {
  try {
    // Check if migration is needed
    const hasAssetTagName = db.prepare("PRAGMA table_info(individual_items)").all().some(col => col.name === 'asset_tag_name');
    if (hasAssetTagName) {
      console.log("Database already migrated");
      return true;
    }
    
    // Create backup
    if (!backupDatabase()) {
      throw new Error("Failed to create backup");
    }
    
    // Add new columns
    db.exec(`
      ALTER TABLE individual_items ADD COLUMN asset_tag_name TEXT DEFAULT '';
    `);
    
    // Update existing records with model names in asset_tag_name
    const getModels = db.prepare('SELECT id, name FROM instrument_models');
    const models = getModels.all();
    const modelMap = new Map(models.map(m => [m.id, m.name]));
    const getItems = db.prepare('SELECT id, asset_tag_number, model_id FROM individual_items');
    const items = getItems.all();
    const updateItem = db.prepare('UPDATE individual_items SET asset_tag_name = ? WHERE id = ?');
    
    items.forEach(item => {
      const modelName = modelMap.get(item.model_id);
      if (modelName) {
        updateItem.run(modelName, item.id);
      }
    });
    
    console.log("Database migration completed successfully!");
    return true;
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

// Migration: asset_tag_number was previously UNIQUE across the whole table instead of
// just per-model, and old rows still had the model name baked into the value (e.g. "Ukulele 3").
function migrateAssetTagNumberConstraint() {
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'individual_items'").get().sql;
  const needsConstraintRebuild = /asset_tag_number\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql);

  if (needsConstraintRebuild) {
    if (!backupDatabase()) {
      throw new Error("Failed to create backup");
    }

    const hasResourceTitle = db.prepare("PRAGMA table_info(individual_items)").all()
      .some(col => col.name === 'resource_title');
    const resourceTitleValue = hasResourceTitle ? 'resource_title' : "''";
    const rebuild = db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      db.exec('ALTER TABLE individual_items RENAME TO individual_items_old');
      db.exec(`
        CREATE TABLE individual_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model_id INTEGER,
          asset_tag_number TEXT NOT NULL,
          asset_tag_name TEXT,
          resource_title TEXT NOT NULL DEFAULT '',
          purchase_date TEXT,
          status TEXT DEFAULT 'Good',
          repair_notes TEXT DEFAULT '',
          FOREIGN KEY(model_id) REFERENCES instrument_models(id) ON DELETE CASCADE,
          UNIQUE(model_id, asset_tag_number)
        )
      `);
      db.exec(`
        INSERT INTO individual_items (id, model_id, asset_tag_number, asset_tag_name, resource_title, purchase_date, status, repair_notes)
        SELECT id, model_id, asset_tag_number, asset_tag_name, ${resourceTitleValue}, purchase_date, status, repair_notes
        FROM individual_items_old
      `);
      db.exec('DROP TABLE individual_items_old');
      db.pragma('foreign_keys = ON');
    });

    rebuild();
    console.log("Rebuilt individual_items with a per-model unique constraint.");
  }

  // Strip any leftover model name text out of asset_tag_number, keeping just the number
  const dirtyRows = db.prepare("SELECT id, asset_tag_number FROM individual_items WHERE asset_tag_number GLOB '*[^0-9]*'").all();
  if (dirtyRows.length > 0) {
    const updateRow = db.prepare('UPDATE individual_items SET asset_tag_number = ? WHERE id = ?');
    const cleanup = db.transaction((rows) => {
      for (const row of rows) {
        const match = row.asset_tag_number.match(/(\d+)\s*$/);
        if (match) updateRow.run(match[1], row.id);
      }
    });
    cleanup(dirtyRows);
    console.log(`Cleaned up ${dirtyRows.length} asset_tag_number value(s).`);
  }
}

function migrateResourceTitleColumn() {
  const hasResourceTitle = db.prepare("PRAGMA table_info(individual_items)").all()
    .some(col => col.name === 'resource_title');
  if (hasResourceTitle) return;

  if (!backupDatabase()) {
    throw new Error("Failed to create backup before adding resource titles");
  }

  db.exec("ALTER TABLE individual_items ADD COLUMN resource_title TEXT NOT NULL DEFAULT ''");
  console.log("Added resource_title to individual_items.");
}

// Inject Fresh Starter Data into Both Tables
const checkData = db.prepare("SELECT COUNT(*) as count FROM instrument_models").get();

if (checkData.count === 0) {
    console.log("Database is empty! Injecting itemized music room assets...");

    // Statements to insert into models
    const insertModel = db.prepare(`INSERT INTO instrument_models (name, category) VALUES (?, ?)`);
    
    // Statements to insert into individual items
    const insertItem = db.prepare(`
        INSERT INTO individual_items (model_id, asset_tag_number, asset_tag_name, purchase_date, status, repair_notes) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    // --- Insert Tubano Drums (Model ID will be 1) ---
    const tubanoResult = insertModel.run("Tubano Drum", "Percussion");
    const tubanoId = tubanoResult.lastInsertRowid;
    
    insertItem.run(tubanoId, "1", "Tubano Drum", "2023-01-15", "Good", "");
    insertItem.run(tubanoId, "2", "Tubano Drum", "2023-01-15", "Good", "");
    insertItem.run(tubanoId, "3", "Tubano Drum", "2023-01-15", "Good", "");
    insertItem.run(tubanoId, "4", "Tubano Drum", "2023-01-15", "Needs New Drum Head", "");

    // --- Insert Ukuleles (Model ID will be 2) ---
    const ukeResult = insertModel.run("Ukulele", "Strings");
    const ukeId = ukeResult.lastInsertRowid;
    
    // Let's create a quick loop to insert 14 good ukuleles and 1 broken one
    for (let i = 1; i <= 14; i++) {
        insertItem.run(ukeId, `${i}`, "Ukulele", "2024-09-01", "Good", "");
    }
    insertItem.run(ukeId, "15", "Ukulele", "2024-09-01", "Needs Tuning Peg Repair", "");

     // --- Insert Headphones (Model ID will be 3) ---
    const phoneResult = insertModel.run("Headphones", "Audio Accessories");
    const phoneId = phoneResult.lastInsertRowid; // This grabs the number 3
    
    // Smoothly loop and insert all 30 headphones into individual_items
    for (let i = 1; i <= 30; i++) {
        // FIXED: We pass phoneId directly into insertItem.run()
        insertItem.run(phoneId, `${i}`, "Headphones", "2025-08-20", "Good", "");
    }

    console.log("Itemized starter items successfully stored!");
}

// Export a function to update instrument groups
const updateInstrumentGroup = (payload) => {
  const { id, name, category, addQuantity, purchaseDate } = payload;

  try {
    // Update the instrument_models table
    const updateModel = db.prepare('UPDATE instrument_models SET name = ?, category = ? WHERE id = ?');
    updateModel.run(name, category, id);

    if (addQuantity > 0) {
      // Get current count for this model to assign sequential numbers
      const getCount = db.prepare('SELECT COUNT(*) as current_count FROM individual_items WHERE model_id = ?');
      const { current_count } = getCount.get(id);
      
      // Insert new items into the individual_items table
      const insertItem = db.prepare(`
        INSERT INTO individual_items (model_id, asset_tag_number, asset_tag_name, purchase_date, status) 
        VALUES (?, ?, ?, ?, 'Good')
      `);
      
      for (let i = 1; i <= addQuantity; i++) {
        const assetTagNumber = `${current_count + i}`;
        insertItem.run(id, assetTagNumber, name, purchaseDate);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update instrument model:", error);
    return { success: false, error: error.message };
  }
};

// Category management: list, add, rename (cascades to instrument_models.category), and delete
function getCategories() {
  return db.prepare('SELECT id, name FROM categories ORDER BY name ASC').all();
}

function addCategory(name) {
  try {
    db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    return { success: true };
  } catch (error) {
    console.error("Error adding category:", error);
    return { success: false, error: error.message };
  }
}

function renameCategory(id, newName) {
  try {
    const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(id);
    if (!category) throw new Error("Category not found");

    const rename = db.transaction(() => {
      db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(newName, id);
      db.prepare('UPDATE instrument_models SET category = ? WHERE category = ?').run(newName, category.name);
    });
    rename();
    return { success: true };
  } catch (error) {
    console.error("Error renaming category:", error);
    return { success: false, error: error.message };
  }
}

function deleteCategory(id) {
  try {
    const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(id);
    if (!category) throw new Error("Category not found");

    const { count } = db.prepare('SELECT COUNT(*) as count FROM instrument_models WHERE category = ?').get(category.name);
    if (count > 0) {
      throw new Error(`"${category.name}" is still used by ${count} instrument group(s). Reassign them to a different category first.`);
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return { success: true };
  } catch (error) {
    console.error("Error deleting category:", error);
    return { success: false, error: error.message };
  }
}

// NEW: Function to rename individual items and update all asset tags
function renameIndividualItems(oldModelName, newModelName) {
    try {
        const getModelId = db.prepare('SELECT id FROM instrument_models WHERE name = ?');
        const model = getModelId.get(oldModelName);
        
        if (!model) {
            throw new Error(`Model "${oldModelName}" not found`);
        }
        
        const modelId = model.id;
        
        // Update the model name in instrument_models table
        const updateModel = db.prepare('UPDATE instrument_models SET name = ? WHERE id = ?');
        updateModel.run(newModelName, modelId);
        
        // Update asset_tag_name for all items of this model
        const updateItems = db.prepare('UPDATE individual_items SET asset_tag_name = ? WHERE model_id = ?');
        updateItems.run(newModelName, modelId);
        
        return { success: true };
    } catch (error) {
        console.error("Error renaming individual items:", error);
        throw error;
    }
}

// NEW: Function to get instruments with counts and repair status
function getInstruments() {
  try {
    const query = db.prepare(`
      SELECT 
        m.id,
        m.name,
        m.category,
        COUNT(i.id) as total_quantity,
        SUM(CASE WHEN i.status != 'Good' THEN 1 ELSE 0 END) as items_needing_repair
      FROM instrument_models m
      LEFT JOIN individual_items i ON m.id = i.model_id
      GROUP BY m.id, m.name, m.category
      ORDER BY m.name
    `);
    
    return query.all();
  } catch (error) {
    console.error("Error getting instruments:", error);
    throw error;
  }
}

// NEW: Function to get model details with individual items
function getModelDetails(modelId) {
  try {
    const query = db.prepare(`
      SELECT 
        i.id,
        i.asset_tag_number,
        i.asset_tag_name,
        i.purchase_date,
        i.status,
        i.repair_notes
      FROM individual_items i
      WHERE i.model_id = ?
      ORDER BY CAST(i.asset_tag_number AS INTEGER)
    `);
    
    return query.all(modelId);
  } catch (error) {
    console.error("Error getting model details:", error);
    throw error;
  }
}

// NEW: Function to update item status 
function toggleItemStatus(assetId, newStatus) {
  try {
    // Update the item status
    const updateQuery = db.prepare('UPDATE individual_items SET status = ? WHERE id = ?');
    updateQuery.run(newStatus, assetId);
    
    return { success: true };
  } catch (error) {
    console.error("Error toggling item status:", error);
    return { success: false, error: error.message };
  }
}

// NEW: Function to delete an item
function deleteItem(assetId) {
  try {
    // Delete the item
    const deleteQuery = db.prepare('DELETE FROM individual_items WHERE id = ?');
    deleteQuery.run(assetId);
    
    return { success: true };
  } catch (error) {
    console.error("Error deleting item:", error);
    return { success: false, error: error.message };
  }
}

// NEW: Function to add a new instrument model
function addInstrumentModel(name, category, quantity, purchaseDate) {
  try {
    // Insert model
    const insertModel = db.prepare('INSERT INTO instrument_models (name, category) VALUES (?, ?)');
    const modelResult = insertModel.run(name, category);
    const modelId = modelResult.lastInsertRowid;
    
    // Insert individual items with proper asset tag numbers
    const insertItem = db.prepare(`
      INSERT INTO individual_items (model_id, asset_tag_number, asset_tag_name, purchase_date, status) 
      VALUES (?, ?, ?, ?, 'Good')
    `);
    
    // Get current count for this model to assign sequential numbers
    const getCount = db.prepare('SELECT COUNT(*) as count FROM individual_items WHERE model_id = ?');
    const { count } = getCount.get(modelId);
    
    for (let i = 1; i <= quantity; i++) {
      const assetTagNumber = `${count + i}`;
      insertItem.run(modelId, assetTagNumber, name, purchaseDate);
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error adding instrument model:", error);
    return { success: false, error: error.message };
  }
}

// NEW: Function to update item notes
function updateItemNotes(assetId, notes) {
  try {
    const updateQuery = db.prepare('UPDATE individual_items SET repair_notes = ? WHERE id = ?');
    updateQuery.run(notes, assetId);
    
    return { success: true };
  } catch (error) {
    console.error("Error updating item notes:", error);
    return { success: false, error: error.message };
  }
}

// NEW: Function to update item purchase date
function updateItemDate(assetId, date) {
  try {
    const updateQuery = db.prepare('UPDATE individual_items SET purchase_date = ? WHERE id = ?');
    updateQuery.run(date, assetId);
    
    return { success: true };
  } catch (error) {
    console.error("Error updating item date:", error);
    return { success: false, error: error.message };
  }
}

// NEW: Function to permanently delete an instrument model and all its individual items
function deleteInstrumentModel(modelId) {
  try {
    const model = db.prepare('SELECT id FROM instrument_models WHERE id = ?').get(modelId);
    if (!model) throw new Error("Instrument not found");

    const executeTransaction = db.transaction(() => {
      // Explicitly remove individual items first (ON DELETE CASCADE covers this too, but this keeps intent clear)
      db.prepare('DELETE FROM individual_items WHERE model_id = ?').run(modelId);
      db.prepare('DELETE FROM instrument_models WHERE id = ?').run(modelId);
    });

    executeTransaction();
    return { success: true };
  } catch (error) {
    console.error("Error deleting instrument model:", error);
    return { success: false, error: error.message };
  }
}

// Run migration if needed
migrateToNewSchema();
migrateAssetTagNumberConstraint();
migrateResourceTitleColumn();

// Created after the migrations so it always references the final individual_items table
db.exec(`
  CREATE TABLE IF NOT EXISTS repair_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    entry_date TEXT,
    description TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(item_id) REFERENCES individual_items(id) ON DELETE CASCADE
  )
`);

// Export all functions
module.exports = {
  db,
  updateInstrumentGroup,
  renameIndividualItems,
  getInstruments,
  getModelDetails,
  toggleItemStatus,
  deleteItem,
  addInstrumentModel,
  updateItemNotes,
  updateItemDate,
  deleteInstrumentModel,
  getCategories,
  addCategory,
  renameCategory,
  deleteCategory
};