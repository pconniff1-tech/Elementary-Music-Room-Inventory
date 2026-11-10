const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, custom API to our renderer.js file
contextBridge.exposeInMainWorld('inventoryAPI', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    restartToUpdate: () => ipcRenderer.invoke('restart-to-update'),
    onUpdateStateChanged: (callback) => {
        ipcRenderer.on('update-state-changed', (_event, state) => callback(state));
    },
    // Dialogs that don't break text field focus like the renderer's alert()/confirm() do
    showConfirm: (message) => ipcRenderer.invoke('show-confirm-dialog', message),
    showAlert: (message) => ipcRenderer.invoke('show-alert-dialog', message),
    // This function tells the main process to fetch all instruments
    getInstruments: () => ipcRenderer.invoke('fetch-instruments-from-db'),

    // NEW: Fetch specific individual items for a single model category
    getModelDetails: (modelId) => ipcRenderer.invoke('fetch-model-details-from-db', modelId),

     // NEW: Send the new instrument form data to the main process
    addInstrumentModel: (formData) => ipcRenderer.invoke('add-new-instrument-to-db', formData),

    // NEW: Send an update request to change a specific item's condition status
    toggleItemStatus: (itemId, newStatus) => ipcRenderer.invoke('update-item-status-in-db', itemId, newStatus),

    // NEW: Save custom repair note descriptions
    updateItemNotes: (itemId, notes) => ipcRenderer.invoke('update-item-notes-in-db', itemId, notes),

    // Save an individual teacher-text/resource title
    updateResourceTitle: (itemId, title) => ipcRenderer.invoke('update-item-resource-title-in-db', itemId, title),

    // Repair log entries
    getRepairLog: (modelId) => ipcRenderer.invoke('fetch-repair-log-for-model-from-db', modelId),
    addRepairLogEntry: (itemId, entryDate, description) => ipcRenderer.invoke('add-repair-log-entry-to-db', itemId, entryDate, description),
    updateRepairLogEntry: (entryId, entryDate, description) => ipcRenderer.invoke('update-repair-log-entry-in-db', entryId, entryDate, description),

    // NEW: Update instrument group
    updateInstrumentGroup: (payload) => ipcRenderer.invoke('update-instrument-group-in-db', payload),

    // NEW: Update item purchase date
    updateItemDate: (itemId, newDate) => ipcRenderer.invoke('update-item-date-in-db', itemId, newDate),

    // NEW: Delete an item from the database
    deleteItem: (itemId) => ipcRenderer.invoke('delete-item-from-db', itemId),

    // NEW: Permanently delete an instrument model and all its individual items
    deleteInstrumentModel: (modelId) => ipcRenderer.invoke('delete-instrument-model-from-db', modelId),

     // NEW: Rename individual items based on a new model name
    renameIndividualItems: async (oldModelName, newModelName) => {
        const result = await ipcRenderer.invoke('rename-individual-items', oldModelName, newModelName);
        return result;
    },

    // Category settings menu
    getCategories: () => ipcRenderer.invoke('fetch-categories-from-db'),
    addCategory: (name) => ipcRenderer.invoke('add-category-to-db', name),
    renameCategory: (id, newName) => ipcRenderer.invoke('rename-category-in-db', id, newName),
    deleteCategory: (id) => ipcRenderer.invoke('delete-category-from-db', id)
});