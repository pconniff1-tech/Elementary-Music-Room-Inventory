const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const db = require('./database.js');
const { autoUpdater } = require('electron-updater');
const { createUpdateController } = require('./updates.js');

const updates = createUpdateController({
  app,
  updater: autoUpdater,
  onChange: state => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('update-state-changed', state);
    }
  }
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
        // this links the preload script to the window for security reasons
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
    }
  });
  //This tells the window to load your HTML visual interface file index.html
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    }
// When Electron is ready, open the window
app.whenReady().then(() => {
  createWindow();
// This is for macOS, where apps stay open until the user quits explicitly with Cmd + Q
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        }
    }); 
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});     


//First Listener
const { ipcMain } = require('electron');

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-for-updates', () => updates.check());
ipcMain.handle('download-update', () => updates.download());
ipcMain.handle('restart-to-update', () => updates.restart());

// Native dialogs shown from the main process. The renderer's built-in alert()/confirm()
// leave Electron windows unable to focus text fields afterwards, so we avoid them.
ipcMain.handle('show-confirm-dialog', async (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['OK', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: String(message)
    });
    return response === 0;
});

ipcMain.handle('show-alert-dialog', async (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await dialog.showMessageBox(win, { type: 'info', buttons: ['OK'], message: String(message) });
    return true;
});

// Listen for the frontend requesting the instrument list
ipcMain.handle('fetch-instruments-from-db', async () => {
    // This query pulls the model name, counts the items, and identifies issues
    const query = `
      SELECT 
        m.id,
        m.name, 
        m.category, 
        COUNT(i.id) as total_quantity,
        SUM(CASE WHEN i.status != 'Good' THEN 1 ELSE 0 END) as items_needing_repair
      FROM instrument_models m
      LEFT JOIN individual_items i ON m.id = i.model_id
      GROUP BY m.id
      ORDER BY m.category ASC, m.name ASC 
    `;
    
    const stmt = db.db.prepare(query);
    const rows = stmt.all();
    return rows;
});

// Listen for when the UI asks for individual item details
ipcMain.handle('fetch-model-details-from-db', async (event, modelId) => {
    const query = `
        SELECT id, asset_tag_number, asset_tag_name, resource_title, purchase_date, status, repair_notes
        FROM individual_items 
        WHERE model_id = ?
        ORDER BY CAST(asset_tag_number AS INTEGER) ASC 
    
    `;
    
    const stmt = db.db.prepare(query);
    const rows = stmt.all(modelId);
    return rows;
});

// Listen for when the UI submits a new instrument form
ipcMain.handle('add-new-instrument-to-db', async (event, formData) => {
    const { name, category, quantity, purchaseDate } = formData;

    try {
        // 1. Start a database transaction so either everything saves perfectly or nothing does
        const executeTransaction = db.db.transaction(() => {
            // 2. Insert the main instrument type into instrument_models
            const insertModel = db.db.prepare('INSERT INTO instrument_models (name, category) VALUES (?, ?)');
            const modelResult = insertModel.run(name, category);
            const modelId = modelResult.lastInsertRowid;

            // 3. Automatically loop and create each individual item row based on the quantity
            const insertItem = db.db.prepare(`
                INSERT INTO individual_items (model_id, asset_tag_number, asset_tag_name, purchase_date, status) 
                VALUES (?, ?, ?, ?, 'Good')
            `);

            for (let i = 1; i <= quantity; i++) {
                // asset_tag_number stays a plain number so it keeps matching the physical tag
                insertItem.run(modelId, `${i}`, name, purchaseDate);
            }
        });

        // Run the transaction
        executeTransaction();
        return { success: true };

    } catch (error) {
        console.error("Database insert failed:", error);
        return { success: false, error: error.message };
    }
});

// Listen for when the UI requests an individual item status change
ipcMain.handle('update-item-status-in-db', async (event, itemId, newStatus) => {
    try {
        let stmt;
    if (newStatus === 'Good') {
      // If moving to Good, clear out the repair notes completely
      stmt = db.db.prepare('UPDATE individual_items SET status = ?, repair_notes = NULL WHERE id = ?');
      stmt.run(newStatus, itemId);
    } else {
      // If moving to Needs Repair, just update the status string
      stmt = db.db.prepare('UPDATE individual_items SET status = ? WHERE id = ?');
      stmt.run(newStatus, itemId);
    }
        return { success: true };
    } catch (error) {
        console.error("Failed to update item status:", error);
        return { success: false, error: error.message };
    }
});

// 2. NEW: Add the notes updater listener at the very bottom of app.js
// This listens for when the UI sends a request to update repair notes for a specific item
ipcMain.handle('update-item-notes-in-db', async (event, itemId, notes) => {
    try {
        const stmt = db.db.prepare('UPDATE individual_items SET repair_notes = ? WHERE id = ?');
        stmt.run(notes, itemId);
        return { success: true };
    } catch (error) {
        console.error("Failed to update notes:", error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-item-resource-title-in-db', async (event, itemId, title) => {
    try {
        const stmt = db.db.prepare('UPDATE individual_items SET resource_title = ? WHERE id = ?');
        stmt.run(title, itemId);
        return { success: true };
    } catch (error) {
        console.error("Failed to update item resource title:", error);
        return { success: false, error: error.message };
    }
});

// Repair log: newest repair date first; entries on the same date show the most recently added first
ipcMain.handle('fetch-repair-log-for-model-from-db', async (event, modelId) => {
    try {
        return db.db.prepare(`
            SELECT r.id, r.item_id, r.entry_date, r.description
            FROM repair_log r
            JOIN individual_items i ON i.id = r.item_id
            WHERE i.model_id = ?
            ORDER BY r.entry_date DESC, r.id DESC
        `).all(modelId);
    } catch (error) {
        console.error("Failed to fetch repair log:", error);
        return [];
    }
});

ipcMain.handle('add-repair-log-entry-to-db', async (event, itemId, entryDate, description) => {
    try {
        const result = db.db.prepare('INSERT INTO repair_log (item_id, entry_date, description) VALUES (?, ?, ?)')
            .run(itemId, entryDate, description);
        return { success: true, id: Number(result.lastInsertRowid) };
    } catch (error) {
        console.error("Failed to add repair log entry:", error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-repair-log-entry-in-db', async (event, entryId, entryDate, description) => {
    try {
        db.db.prepare('UPDATE repair_log SET entry_date = ?, description = ? WHERE id = ?')
            .run(entryDate, description, entryId);
        return { success: true };
    } catch (error) {
        console.error("Failed to update repair log entry:", error);
        return { success: false, error: error.message };
    }
});

// app.js - Fixed the update-instrument-group-in-db handler
ipcMain.handle('update-instrument-group-in-db', async (event, payload) => {
  const { id, name, category, addQuantity, purchaseDate } = payload;
  
  try {
    const executeTransaction = db.db.transaction(() => {
      // 1. Correct any catalog typos or grouping mismatches
      const updateModel = db.db.prepare('UPDATE instrument_models SET name = ?, category = ? WHERE id = ?');
      updateModel.run(name, category, id);

      // Keep every existing individual item's display name in sync with the model name
      const updateItemNames = db.db.prepare('UPDATE individual_items SET asset_tag_name = ? WHERE model_id = ?');
      updateItemNames.run(name, id);

      // 2. Expand individual item sets safely if required
      if (addQuantity > 0) {
        const existingRows = db.db.prepare('SELECT asset_tag_number FROM individual_items WHERE model_id = ?').all(id);
        const usedNumbers = new Set(
          existingRows
            .map(row => parseInt(row.asset_tag_number, 10))
            .filter(num => !isNaN(num))
        );

        const insertItem = db.db.prepare(`
          INSERT INTO individual_items (model_id, asset_tag_number, asset_tag_name, purchase_date, status) 
          VALUES (?, ?, ?, ?, 'Good')
        `);

        // Fill any gaps left by deleted tags (e.g. 1, 4, 5 -> next new tags are 2, 3) before growing past the highest number
        let candidate = 1;
        let remaining = addQuantity;
        while (remaining > 0) {
          if (!usedNumbers.has(candidate)) {
            insertItem.run(id, `${candidate}`, name, purchaseDate);
            usedNumbers.add(candidate);
            remaining--;
          }
          candidate++;
        }
      }
    });

    executeTransaction();
    return { success: true };
  } catch (error) {
    console.error("Failed to modify instrument model:", error);
    return { success: false, error: error.message };
  }
});

// Inside app.js (At the absolute bottom of the file)
ipcMain.handle('update-item-date-in-db', async (event, itemId, newDate) => {
  try {
    const stmt = db.db.prepare('UPDATE individual_items SET purchase_date = ? WHERE id = ?');
    stmt.run(newDate, itemId);
    return { success: true };
  } catch (error) {
    console.error("Failed to update item purchase date:", error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('delete-item-from-db', async (event, itemId) => {
  console.log("Attempting to delete item with ID:", itemId); // Log the item ID

  try {
    const deleteStmt = db.db.prepare('DELETE FROM individual_items WHERE id = ?');
    const result = await deleteStmt.run(itemId); // Use await here

    if (result.changes === 1) {
      console.log("Item deleted successfully"); // Log success
      return { success: true };
    } else {
      console.log("Item not found"); // Log failure
      return { success: false, error: 'Item not found' };
    }
  } catch (error) {
    console.error("Failed to delete item from database:", error); // Log error
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-individual-items', async (event, oldModelName, newModelName) => {
    try {
        // Use the db helper so individual_items.asset_tag_name gets updated too, not just the model name
        return db.renameIndividualItems(oldModelName, newModelName);
    } catch (error) {
        console.error("Error renaming individual items:", error);
        return { success: false, error: error.message };
    }
});

// Permanently deletes an instrument model and every individual item tied to it
ipcMain.handle('delete-instrument-model-from-db', async (event, modelId) => {
    try {
        return db.deleteInstrumentModel(modelId);
    } catch (error) {
        console.error("Error deleting instrument model:", error);
        return { success: false, error: error.message };
    }
});

// Category management listeners for the settings modal
ipcMain.handle('fetch-categories-from-db', async () => {
    return db.getCategories();
});

ipcMain.handle('add-category-to-db', async (event, name) => {
    return db.addCategory(name);
});

ipcMain.handle('rename-category-in-db', async (event, id, newName) => {
    return db.renameCategory(id, newName);
});

ipcMain.handle('delete-category-from-db', async (event, id) => {
    return db.deleteCategory(id);
});