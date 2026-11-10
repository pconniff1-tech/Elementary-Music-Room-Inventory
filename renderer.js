// renderer.js - Fixed version with proper error handling
// Route every alert() through the main process; the built-in one breaks text field focus in Electron.
window.alert = (message) => { window.inventoryAPI.showAlert(String(message)); };
// Dates are stored/edited as ISO (YYYY-MM-DD) since <input type="date"> requires it; display as MM/DD/YYYY
const expandedInventoryCategories = new Set();

function formatDateForDisplay(isoDateString) {
  if (!isoDateString) return '';
  const [year, month, day] = isoDateString.split('-');
  if (!year || !month || !day) return isoDateString;
  return `${month}/${day}/${year}`;
}
// Reusable inline-editable text fields for individual item rows.
// To add another field: add an entry here (and a matching save API + DB column).
const EDITABLE_FIELDS = {
  resource_title: {
    placeholder: 'Add desc, brand, color etc',
    ariaLabel: (item) => `Description for ${item.asset_tag_name} ${item.asset_tag_number}`,
    save: (itemId, value) => window.inventoryAPI.updateResourceTitle(itemId, value)
  }
};

// Grows/shrinks the textarea to fit its wrapped text; the flex row grows with it.
function autosizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

// Shared auto-growing single-paragraph textarea. Enter blurs it (which triggers the owner's save).
function createAutosizeTextarea({ value = '', placeholder = '', ariaLabel = '', className = '' }) {
  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.className = `autosize-textarea ${className}`.trim();
  textarea.value = value;
  textarea.placeholder = placeholder;
  if (ariaLabel) textarea.setAttribute('aria-label', ariaLabel);
  textarea.style.cssText = 'display: block; width: 95%; box-sizing: border-box; margin: 4px 0; padding: 5px; border: 1px solid #cbd5e0; border-radius: 4px; resize: none; overflow: hidden; font: inherit; font-size: 13px;';
  textarea.addEventListener('input', () => autosizeTextarea(textarea));
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); textarea.blur(); }
  });
  // scrollHeight is 0 until attached to the DOM, so size on the next frame
  requestAnimationFrame(() => autosizeTextarea(textarea));
  return textarea;
}

function createEditableField(fieldKey, item) {
  const config = EDITABLE_FIELDS[fieldKey];
  const input = createAutosizeTextarea({
    value: item[fieldKey] || '',
    placeholder: config.placeholder,
    ariaLabel: config.ariaLabel(item),
    className: 'editable-field-input'
  });
  input.dataset.field = fieldKey;
  return input;
}

window.addEventListener('resize', () => {
  document.querySelectorAll('.autosize-textarea').forEach(autosizeTextarea);
});

function todayISO() {
  return new Date().toLocaleDateString('en-CA');
}

// Repair log: a header with a + button and a list of entries, newest first.
function createRepairLogEntry(entry, item) {
  const row = document.createElement('div');
  row.className = 'repair-log-entry';
  row.style.cssText = 'display: flex; gap: 6px; align-items: flex-start;';
  const text = entry ? entry.description : '';
  const date = entry ? (entry.entry_date || '') : todayISO();
  if (entry) row.dataset.entryId = entry.id;
  row.dataset.savedText = text;
  row.dataset.savedDate = date;

  const textarea = createAutosizeTextarea({
    value: text,
    placeholder: 'Describe the repair completed',
    ariaLabel: `Repair completed on ${item.asset_tag_name} ${item.asset_tag_number}`,
    className: 'repair-log-text'
  });
  textarea.style.width = 'auto';
  textarea.style.flex = '1';
  textarea.style.minWidth = '0';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'repair-log-date';
  dateInput.value = date;
  dateInput.setAttribute('aria-label', 'Repair date');
  dateInput.style.cssText = 'margin: 4px 0; padding: 2px; font-size: 12px;';

  row.append(textarea, dateInput);
  return row;
}

function createRepairLogSection(item, entries) {
  const section = document.createElement('div');
  section.className = 'repair-log-section';
  section.style.cssText = 'margin-top: 8px; width: 95%;';

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; gap: 6px;';
  const title = document.createElement('small');
  title.textContent = 'Repair log';
  title.style.cssText = 'color: #666; font-weight: bold;';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'repair-log-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Add repair log entry';
  addBtn.setAttribute('aria-label', 'Add repair log entry');
  addBtn.style.cssText = 'cursor: pointer; padding: 0 7px; line-height: 18px; border: 1px solid #cbd5e0; border-radius: 4px; background: #fff;';
  header.append(title, addBtn);

  const list = document.createElement('div');
  list.className = 'repair-log-list';
  entries.forEach(entry => list.appendChild(createRepairLogEntry(entry, item)));

  section.append(header, list);
  return section;
}

// Mirrors the database order: newest repair date first, then most recently added.
// Unsaved drafts have no id yet and stay pinned at the top.
function sortRepairLogList(list) {
  const sorted = [...list.children].sort((a, b) => {
    const aDraft = !a.dataset.entryId;
    const bDraft = !b.dataset.entryId;
    if (aDraft !== bDraft) return aDraft ? -1 : 1;
    if (aDraft) return 0;
    const dateCompare = (b.dataset.savedDate || '').localeCompare(a.dataset.savedDate || '');
    return dateCompare || Number(b.dataset.entryId) - Number(a.dataset.entryId);
  });
  sorted.forEach(el => list.appendChild(el));
}

// Delegated: + adds a draft entry at the top; leaving an entry (Enter or clicking away) saves it.
function attachRepairLogHandlers(wrapper, assetCache) {
  wrapper.addEventListener('click', (event) => {
    if (!event.target.classList.contains('repair-log-add-btn')) return;
    const row = event.target.closest('.breakdown-row');
    const list = row.querySelector('.repair-log-list');
    const existingDraft = list.querySelector('.repair-log-entry:not([data-entry-id])');
    if (existingDraft) {
      existingDraft.querySelector('.repair-log-text').focus();
      return;
    }
    const draft = createRepairLogEntry(null, assetCache.get(row.dataset.assetId));
    list.prepend(draft);
    draft.querySelector('.repair-log-text').focus();
  });

  wrapper.addEventListener('focusout', async (event) => {
    const entryEl = event.target.closest && event.target.closest('.repair-log-entry');
    if (!entryEl) return;
    // Moving between the text and date of the same entry is not "clicking away"
    if (event.relatedTarget && entryEl.contains(event.relatedTarget)) return;
    if (entryEl.dataset.saving) return;

    const textarea = entryEl.querySelector('.repair-log-text');
    const dateInput = entryEl.querySelector('.repair-log-date');
    const description = textarea.value.trim();
    const entryDate = dateInput.value || todayISO();
    const isDraft = !entryEl.dataset.entryId;

    if (!description) {
      if (isDraft) {
        entryEl.remove();
      } else {
        textarea.value = entryEl.dataset.savedText;
        autosizeTextarea(textarea);
      }
      return;
    }
    if (!isDraft && description === entryEl.dataset.savedText && entryDate === entryEl.dataset.savedDate) return;

    entryEl.dataset.saving = 'true';
    try {
      const itemId = entryEl.closest('.breakdown-row').dataset.assetId;
      const result = isDraft
        ? await window.inventoryAPI.addRepairLogEntry(itemId, entryDate, description)
        : await window.inventoryAPI.updateRepairLogEntry(entryEl.dataset.entryId, entryDate, description);
      if (result.success) {
        if (isDraft) entryEl.dataset.entryId = result.id;
        entryEl.dataset.savedText = description;
        entryEl.dataset.savedDate = entryDate;
        textarea.value = description;
        autosizeTextarea(textarea);
        sortRepairLogList(entryEl.parentNode);
      } else {
        alert('Failed to save repair log entry: ' + result.error);
      }
    } finally {
      delete entryEl.dataset.saving;
    }
  });
}

// Delegated handler: saves any .editable-field-input on change and reverts on failure.
function attachEditableFieldSaving(wrapper, assetCache) {
  wrapper.addEventListener('change', async (event) => {
    const input = event.target;
    if (!input.classList.contains('editable-field-input')) return;
    const fieldKey = input.dataset.field;
    const config = EDITABLE_FIELDS[fieldKey];
    const row = input.closest('.breakdown-row');
    if (!config || !row) return;
    const assetId = row.dataset.assetId;
    const subItem = assetCache.get(assetId);
    const newValue = input.value.trim();
    const result = await config.save(assetId, newValue);
    if (result.success) {
      subItem[fieldKey] = newValue;
      input.value = newValue;
      autosizeTextarea(input);
    } else {
      input.value = subItem[fieldKey] || '';
      autosizeTextarea(input);
      alert(`Failed to save ${fieldKey.replace(/_/g, ' ')}: ` + result.error);
    }
  });
}

async function loadMainDashboard() {
const container = document.getElementById('inventory-container');
try {
// Show loading state
container.innerHTML = '<p>Loading instruments...</p>';
const instruments = await window.inventoryAPI.getInstruments();
if (!instruments || !Array.isArray(instruments)) {
container.innerHTML = '<p>Error: Invalid data received from database</p>';
console.error("Invalid instruments data:", instruments);
return;
}
container.innerHTML = '';
if (instruments.length === 0) {
container.innerHTML = '<p>Your inventory is empty!</p>';
return;
}
const inventoryGroupsByCategory = new Map();
instruments.forEach(item => {
const categoryName = item.category || 'Uncategorized';
if (!inventoryGroupsByCategory.has(categoryName)) {
inventoryGroupsByCategory.set(categoryName, []);
}
inventoryGroupsByCategory.get(categoryName).push(item);
});

const instrumentCache = new Map();
inventoryGroupsByCategory.forEach((categoryItems, categoryName) => {
const categorySection = document.createElement('section');
categorySection.className = 'inventory-category-section';

const categoryToggle = document.createElement('button');
categoryToggle.type = 'button';
categoryToggle.className = 'inventory-category-toggle';
categoryToggle.dataset.category = categoryName;
categoryToggle.setAttribute('aria-expanded', String(expandedInventoryCategories.has(categoryName)));

const arrow = document.createElement('span');
arrow.className = 'inventory-category-arrow';
arrow.setAttribute('aria-hidden', 'true');
arrow.textContent = expandedInventoryCategories.has(categoryName) ? '▼' : '▶';

const title = document.createElement('span');
title.className = 'inventory-category-title';
title.textContent = categoryName;

categoryToggle.append(arrow, title);

const categoryCards = document.createElement('div');
categoryCards.className = 'inventory-category-cards';
categoryCards.hidden = !expandedInventoryCategories.has(categoryName);

categorySection.append(categoryToggle, categoryCards);
container.appendChild(categorySection);

categoryItems.forEach(item => {
instrumentCache.set(String(item.id), item);
const card = document.createElement('div');
card.className = 'category-card';
card.dataset.modelId = item.id;
const alertText = item.items_needing_repair > 0 
? `<span style="color: red; font-weight: bold;">⚠️ ${item.items_needing_repair} need upkeep!</span>` 
: `<span style="color: green;">✔ All OK</span>`;
card.innerHTML = `
<div class="action-select-card" style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 4px;">
<h3 class="action-select-card" style="margin: 0; font-size: 14px; font-weight: 600;">
🔊 <span class="card-name-text">${item.name}</span> 
<small style="color: #666; font-weight: normal;">(${item.category})</small>
</h3>
<button class="edit-card-gear-btn action-edit-gear icon-btn" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 2px;">✏️</button>
</div>
<div class="action-select-card" style="display: flex; gap: 12px; font-size: 12px; color: #555;">
<span class="action-select-card"><strong>Total:</strong> ${item.total_quantity}</span>
<span class="action-select-card">${alertText}</span>
</div>
`;
categoryCards.appendChild(card);
});
});
// Remove old event listeners and reattach new ones
const newContainer = container.cloneNode(true);
container.parentNode.replaceChild(newContainer, container);
// Use single event listener with delegation for all cards
newContainer.addEventListener('click', (event) => {
const target = event.target;
const categoryToggle = target.closest('.inventory-category-toggle');
if (categoryToggle) {
const categoryName = categoryToggle.dataset.category;
const isExpanded = expandedInventoryCategories.has(categoryName);
if (isExpanded) {
expandedInventoryCategories.delete(categoryName);
} else {
expandedInventoryCategories.add(categoryName);
}
categoryToggle.setAttribute('aria-expanded', String(!isExpanded));
categoryToggle.nextElementSibling.hidden = isExpanded;
categoryToggle.querySelector('.inventory-category-arrow').textContent = isExpanded ? '▶' : '▼';
return;
}
const card = target.closest('.category-card');
if (!card) return; 
const modelId = card.dataset.modelId;
const instrumentItem = instrumentCache.get(modelId);
if (target.closest('.action-edit-gear')) {
openEditModelModal(instrumentItem);
return;
}
renderItemDetails(modelId, instrumentItem.name, instrumentItem.category);
});
} catch (error) {
console.error("Dashboard error:", error);
container.innerHTML = '<p style="color: red;">Error loading instruments. Please restart the app.</p>';
// Log detailed error for debugging
if (error.message) {
console.error("Error message:", error.message);
console.error("Error stack:", error.stack);
}
}
}
async function initializeCategoryDropdowns() {
const addSelect = document.getElementById('form-category');
const editSelect = document.getElementById('edit-form-category');
const previousAddValue = addSelect ? addSelect.value : null;
const previousEditValue = editSelect ? editSelect.value : null;
if (addSelect) addSelect.innerHTML = '';
if (editSelect) editSelect.innerHTML = '';
const categories = await window.inventoryAPI.getCategories();
categories.forEach(category => {
if (addSelect) {
const optionAdd = document.createElement('option');
optionAdd.value = category.name;
optionAdd.textContent = category.name;
addSelect.appendChild(optionAdd);
}
if (editSelect) {
const optionEdit = document.createElement('option');
optionEdit.value = category.name;
optionEdit.textContent = category.name;
editSelect.appendChild(optionEdit);
}
});
if (addSelect && previousAddValue) addSelect.value = previousAddValue;
if (editSelect && previousEditValue) editSelect.value = previousEditValue;
}
async function renderItemDetails(modelId, modelName, category) {
const detailContainer = document.getElementById('detail-container');
detailContainer.innerHTML = `<p>Loading detailed item list for ${modelName}...</p>`;
document.querySelectorAll('.category-card').forEach(c => {
c.classList.toggle('selected', c.dataset.modelId == modelId);
});
try {
const details = await window.inventoryAPI.getModelDetails(modelId);
const repairLogEntries = (await window.inventoryAPI.getRepairLog(modelId)) || [];
const repairLogByItem = new Map();
repairLogEntries.forEach(entry => {
if (!repairLogByItem.has(entry.item_id)) repairLogByItem.set(entry.item_id, []);
repairLogByItem.get(entry.item_id).push(entry);
});
if (!details || !Array.isArray(details)) {
detailContainer.innerHTML = '<p style="color: red;">Error: Invalid data received for details</p>';
console.error("Invalid details data:", details);
return;
}
const assetCache = new Map();
detailContainer.innerHTML = `<h3>📋 ${modelName} List</h3><div id="delegated-rows-wrapper"></div>`;
const wrapper = document.getElementById('delegated-rows-wrapper');
const template = document.getElementById('breakdown-row-template');
// Clear previous event listeners
wrapper.innerHTML = '';
details.forEach(subItem => {
assetCache.set(String(subItem.id), subItem);
const rowClone = template.content.cloneNode(true);
const row = rowClone.querySelector('.breakdown-row');
row.dataset.assetId = subItem.id;
row.classList.toggle('needs-upkeep', subItem.status !== 'Good');
// Updated to use asset_tag_name and asset_tag_number for display
row.querySelector('.asset-tag-display').textContent = `${subItem.asset_tag_name} ${subItem.asset_tag_number}`;
row.querySelector('.purchase-date-display').parentNode.insertBefore(
createEditableField('resource_title', subItem),
row.querySelector('.purchase-date-display')
);
row.querySelector('.purchase-date-display').textContent = `Purchased: ${formatDateForDisplay(subItem.purchase_date)}`;
const statusSpan = row.querySelector('.status-text');
statusSpan.textContent = subItem.status;
statusSpan.style.color = subItem.status === 'Good' ? 'green' : 'red';
const toggleBtn = row.querySelector('.action-toggle');
toggleBtn.textContent = subItem.status === 'Good' ? '🔧 Mark Broken' : '✅ Mark Fixed';
toggleBtn.style.backgroundColor = subItem.status === 'Good' ? '#e0a800' : '#28a745';
const deleteBtn = document.createElement('button');
deleteBtn.className = 'delete-btn action-delete-btn gap-left icon-btn';
deleteBtn.textContent = '🗑️';
row.appendChild(deleteBtn);
if (subItem.status !== 'Good') {
const leftColumn = row.querySelector('.row-info-column');
const notesBox = document.createElement('div');
notesBox.className = 'notes-display-box clickable-notes-trigger';
notesBox.textContent = `📝 ${subItem.repair_notes || 'Click to add repair details'}`;
leftColumn.appendChild(notesBox);
}
row.querySelector('.row-info-column').appendChild(
createRepairLogSection(subItem, repairLogByItem.get(subItem.id) || [])
);
wrapper.appendChild(rowClone);
});
// Use single event listener with delegation for all rows
wrapper.addEventListener('click', async (event) => {
const target = event.target;
if (target.classList.contains('action-delete-btn')) {
const row = target.closest('.breakdown-row');
if (!row) return; 
const assetId = row.dataset.assetId;
if (!(await window.inventoryAPI.showConfirm("Are you sure you want to delete this item?"))) {
return;
}
try {
const result = await window.inventoryAPI.deleteItem(assetId);
if (result.success) {
row.remove();
// Refresh the entire dashboard to update all counts
await loadMainDashboard();
// Re-select the current model in the detail view
const currentCard = document.querySelector(`.category-card[data-model-id="${modelId}"]`);
if (currentCard) {
renderItemDetails(modelId, modelName, category);
}
} else {
alert("Failed to delete item: " + result.error);
}
} catch (err) {
console.error("Error deleting item:", err);
alert("Error deleting item.");
}
}
if (target.classList.contains('action-toggle')) {
const row = target.closest('.breakdown-row');
if (!row) return; 
const assetId = row.dataset.assetId;
const subItem = assetCache.get(assetId);
const currentIsGood = subItem.status === 'Good';
const targetStatus = currentIsGood ? 'Needs Repair' : 'Good';
const result = await window.inventoryAPI.toggleItemStatus(assetId, targetStatus);
if (result.success) {
subItem.status = targetStatus;
if (targetStatus === 'Good') subItem.repair_notes = '';
row.classList.toggle('needs-upkeep', targetStatus !== 'Good');
const statusSpan = row.querySelector('.status-text');
statusSpan.textContent = targetStatus;
statusSpan.style.color = targetStatus === 'Good' ? 'green' : 'red';
target.textContent = targetStatus === 'Good' ? '🔧 Mark Broken' : '✅ Mark Fixed';
target.style.backgroundColor = targetStatus === 'Good' ? '#e0a800' : '#28a745';
if (targetStatus === 'Needs Repair') {
const leftColumn = row.querySelector('.row-info-column');
const notesBox = document.createElement('div');
notesBox.className = 'notes-display-box clickable-notes-trigger';
notesBox.textContent = '📝 Click to add repair details';
// Keep the repair note above the repair log
leftColumn.insertBefore(notesBox, leftColumn.querySelector('.repair-log-section'));
} else {
const notesBox = row.querySelector('.notes-display-box');
if (notesBox) notesBox.remove();
}
// Update card upkeep count
const card = document.querySelector(`.category-card[data-model-id="${modelId}"]`);
if (card) {
const alertTextSpan = card.querySelector('span[style*="color"]');
if (alertTextSpan && (alertTextSpan.textContent.includes('⚠%EF%B8%8F') || alertTextSpan.textContent.includes('⚠️'))) {
const match = alertTextSpan.textContent.match(/(\d+)/);
if (match) {
const newCount = Math.max(0, parseInt(match[1], 10) + (targetStatus === 'Good' ? -1 : 1));
if (newCount > 0) {
alertTextSpan.innerHTML = `⚠️ ${newCount} item(s) need upkeep!`;
alertTextSpan.style.color = 'red';
} else {
alertTextSpan.innerHTML = '✔ All OK';
alertTextSpan.style.color = 'green';
}
}
} else if (alertTextSpan && targetStatus === 'Needs Repair') {
alertTextSpan.innerHTML = '⚠️ 1 item(s) need upkeep!';
alertTextSpan.style.color = 'red';
}
}
}
}
// Handle click on notes trigger
if (target.classList.contains('clickable-notes-trigger')) {
if (target.querySelector('input')) return;
const row = target.closest('.breakdown-row');
if (!row) return;
const assetId = row.dataset.assetId;
const subItem = assetCache.get(assetId);
const input = document.createElement('input');
input.type = 'text';
input.value = subItem.repair_notes || '';
input.className = 'notes-edit-input';
target.innerHTML = '';
target.appendChild(input);
setTimeout(() => {
input.focus();
input.setSelectionRange(input.value.length, input.value.length);
}, 0);
const saveNotes = async () => {
const cleanValue = input.value.trim();
const result = await window.inventoryAPI.updateItemNotes(assetId, cleanValue);
if (result.success) {
subItem.repair_notes = cleanValue;
target.innerHTML = cleanValue ? `📝 ${cleanValue}` : `📝 Click to add repair details`;
}
};
input.addEventListener('blur', saveNotes);
input.addEventListener('keydown', (e) => {
if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
if (e.key === 'Escape') {
input.removeEventListener('blur', saveNotes);
target.innerHTML = subItem.repair_notes ? `📝 ${subItem.repair_notes}` : `📝 Click to add repair details`;
}
});
}
// Handle click on purchase date trigger
if (target.classList.contains('clickable-date-trigger')) {
if (target.querySelector('input')) return;
const row = target.closest('.breakdown-row');
if (!row) return;
const assetId = row.dataset.assetId;
const subItem = assetCache.get(assetId);
const dateInput = document.createElement('input');
dateInput.type = 'date';
dateInput.value = subItem.purchase_date || '';
dateInput.style.padding = '2px';
dateInput.style.fontSize = '12px';
target.innerHTML = '';
target.appendChild(dateInput);
setTimeout(() => {
dateInput.focus();
}, 0);
const saveDate = async () => {
const finalDateValue = dateInput.value;
if (!finalDateValue) {
alert("Purchase date cannot be completely empty!");
target.textContent = `Purchased: ${formatDateForDisplay(subItem.purchase_date)}`;
return;
}
const result = await window.inventoryAPI.updateItemDate(assetId, finalDateValue);
if (result.success) {
subItem.purchase_date = finalDateValue; 
target.textContent = `Purchased: ${formatDateForDisplay(finalDateValue)}`;
} else {
alert("Error altering database date cell: " + result.error);
target.textContent = `Purchased: ${formatDateForDisplay(subItem.purchase_date)}`;
}
};
dateInput.addEventListener('blur', saveDate);
dateInput.addEventListener('keydown', (e) => {
if (e.key === 'Enter') { e.preventDefault(); dateInput.blur(); }
if (e.key === 'Escape') {
dateInput.removeEventListener('blur', saveDate);
target.textContent = `Purchased: ${formatDateForDisplay(subItem.purchase_date)}`;
}
});
}
});
attachEditableFieldSaving(wrapper, assetCache);
attachRepairLogHandlers(wrapper, assetCache);
} catch (err) {
console.error("Error drawing list details:", err);
detailContainer.innerHTML = '<p style="color: red;">Error displaying data.</p>';
}
}
window.addEventListener('DOMContentLoaded', () => {
document.getElementById('form-date').valueAsDate = new Date();
const formHeader = document.getElementById('toggle-form-header');
const formWrapper = document.getElementById('form-collapse-wrapper');
const toggleArrow = document.getElementById('form-toggle-arrow');
if (formHeader && formWrapper && toggleArrow) {
formHeader.addEventListener('click', () => {
if (formWrapper.style.display === 'none') {
formWrapper.style.display = 'block';
toggleArrow.textContent = '▼'; 
} else {
formWrapper.style.display = 'none';
toggleArrow.textContent = '▶'; 
}
});
}
initializeCategoryDropdowns();
loadMainDashboard();

const categorySettingsModal = document.getElementById('category-settings-modal');
const categoryListWrapper = document.getElementById('category-list-wrapper');
const categoryRowTemplate = document.getElementById('category-row-template');

async function renderCategorySettingsList() {
categoryListWrapper.innerHTML = '<p>Loading categories...</p>';
try {
const categories = await window.inventoryAPI.getCategories();
categoryListWrapper.innerHTML = '';
categories.forEach(category => {
const rowClone = categoryRowTemplate.content.cloneNode(true);
const row = rowClone.querySelector('.category-settings-row');
row.dataset.categoryId = category.id;
row.querySelector('.category-name-input').value = category.name;
categoryListWrapper.appendChild(rowClone);
});
} catch (error) {
console.error("Error loading categories:", error);
categoryListWrapper.innerHTML = '<p style="color: red;">Error loading categories.</p>';
}
}

document.getElementById('open-category-settings-btn').addEventListener('click', () => {
// Show the modal immediately so it's never blocked by the data fetch below
categorySettingsModal.style.display = 'flex';
renderCategorySettingsList();
});

document.getElementById('category-settings-close').addEventListener('click', () => {
categorySettingsModal.style.display = 'none';
});

categoryListWrapper.addEventListener('click', async (event) => {
const row = event.target.closest('.category-settings-row');
if (!row) return;
const categoryId = parseInt(row.dataset.categoryId, 10);
const input = row.querySelector('.category-name-input');

if (event.target.classList.contains('category-save-btn')) {
const newName = input.value.trim();
if (!newName) { alert("Category name cannot be empty."); return; }
const result = await window.inventoryAPI.renameCategory(categoryId, newName);
if (result.success) {
await initializeCategoryDropdowns();
await loadMainDashboard();
} else {
alert("Failed to rename category: " + result.error);
}
}

if (event.target.classList.contains('category-delete-btn')) {
if (!(await window.inventoryAPI.showConfirm(`Delete category "${input.value}"?`))) return;
const result = await window.inventoryAPI.deleteCategory(categoryId);
if (result.success) {
row.remove();
await initializeCategoryDropdowns();
} else {
alert("Failed to delete category: " + result.error);
}
}
});

document.getElementById('add-category-form').addEventListener('submit', async (event) => {
event.preventDefault();
const input = document.getElementById('new-category-name');
const name = input.value.trim();
if (!name) return;
const result = await window.inventoryAPI.addCategory(name);
if (result.success) {
input.value = '';
await renderCategorySettingsList();
await initializeCategoryDropdowns();
} else {
alert("Failed to add category: " + (result.error.includes('UNIQUE') ? "That category already exists!" : result.error));
}
});

const form = document.getElementById('add-instrument-form');
form.addEventListener('submit', async (event) => {
event.preventDefault();
const formData = {
name: document.getElementById('form-name').value.trim(),
category: document.getElementById('form-category').value,
quantity: parseInt(document.getElementById('form-quantity').value, 10),
purchaseDate: document.getElementById('form-date').value
};
try {
const result = await window.inventoryAPI.addInstrumentModel(formData);
if (result.success) {
document.getElementById('form-name').value = '';
document.getElementById('form-quantity').value = '1';
if (formWrapper && toggleArrow) {
formWrapper.style.display = 'none';
toggleArrow.textContent = '▶';
}
document.getElementById('detail-container').innerHTML = '<p style="color: #666;">inventory item group added! Click a category card on the left to manage individual items.</p>';
await loadMainDashboard();
} else {
if (result.error.includes('UNIQUE constraint failed')) {
alert("Error: An instrument with that name already exists in your inventory!");
} else {
alert("Failed to add instrument: " + result.error);
}
}
} catch (error) {
console.error("Error adding instrument:", error);
alert("Error adding instrument: " + error.message);
}
});
});
function openEditModelModal(item) {
const modal = document.getElementById('edit-model-modal');
document.getElementById('edit-form-id').value = item.id;
document.getElementById('edit-form-name').value = item.name;
document.getElementById('edit-form-category').value = item.category;
document.getElementById('edit-form-add-qty').value = "0";
document.getElementById('edit-form-add-date').valueAsDate = new Date();
window.originalName = item.name;  // Store the original name for later use
modal.style.display = 'flex';
}
document.getElementById('edit-modal-cancel').addEventListener('click', () => {
document.getElementById('edit-model-modal').style.display = 'none';
});
document.getElementById('edit-modal-delete').addEventListener('click', async () => {
const id = parseInt(document.getElementById('edit-form-id').value, 10);
const name = document.getElementById('edit-form-name').value.trim();
if (!(await window.inventoryAPI.showConfirm(`Delete "${name}" permanently? This will remove it and every individual item under it from the inventory. This cannot be undone.`))) return;
try {
const result = await window.inventoryAPI.deleteInstrumentModel(id);
if (result.success) {
document.getElementById('edit-model-modal').style.display = 'none';
await loadMainDashboard();
document.getElementById('detail-container').innerHTML =
`<p style="color: #666;">"${name}" was deleted. Click an item on the left to see individual details.</p>`;
} else {
alert("Error deleting instrument: " + result.error);
}
} catch (error) {
console.error("Error deleting instrument:", error);
alert("Error deleting instrument: " + error.message);
}
});
document.getElementById('edit-model-form').addEventListener('submit', async (e) => {
e.preventDefault();
const payload = {
id: parseInt(document.getElementById('edit-form-id').value, 10),
name: document.getElementById('edit-form-name').value.trim(),
category: document.getElementById('edit-form-category').value,
addQuantity: parseInt(document.getElementById('edit-form-add-qty').value, 10),
purchaseDate: document.getElementById('edit-form-add-date').value
};
try {
const result = await window.inventoryAPI.updateInstrumentGroup(payload);
if (result.success) {
// Individual item names are kept in sync server-side as part of updateInstrumentGroup
document.getElementById('edit-model-modal').style.display = 'none';
await loadMainDashboard();
document.getElementById('detail-container').innerHTML = 
'<p style="color: #666;">Group modified successfully! Click an item on the left to see individual details.</p>';
} else {
alert("Error modifying dataset properties: " + result.error);
}
} catch (error) {
console.error("Error updating instrument group:", error);
alert("Error modifying dataset properties: " + error.message);
}
});
