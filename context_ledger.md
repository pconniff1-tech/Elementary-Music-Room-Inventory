# Context Ledger — Music Room Inventory

## App identity

- **App name:** Music Room Inventory (package name: `music-room-inventory`)
- **Purpose:** Inventory and maintenance tracking for elementary music classrooms.
- **Current version:** `1.0.0` (from `package.json`; no separate application version was found).
- **Application type:** Local desktop application built with Electron.
- **Current data location:** Development uses `inventory.db` beside the application source; installed builds use Electron's per-user `userData` directory. Migration backups are stored alongside the active database as `inventory_backup.db`.
- **Last ledger review:** 2026-11-10

## General functionality

- Shows instrument groups by category, with item totals and counts of items needing repair.
- Groups instrument cards under bold, initially collapsed category headers that can be expanded with an accessible dropdown button.
- Category and selected-item lists scroll independently within their own panels.
- Shows the individual tagged items in a selected group, including purchase date, condition, repair notes, and repair history.
- Displays an editable description on every individual item card, stored in the existing `resource_title` column.
- Records dated repair log entries per item, ordered by repair date with the newest first.
- Adds groups and individual items; edits group name/category; adds quantities to an existing group; deletes individual items or an entire group.
- Marks items as `Good` or needing repair, edits purchase dates and repair notes, and clears repair notes when an item is marked `Good`.
- Manages categories: add, rename (also updates groups using the category), and delete (blocked while groups still use it).
- Seeds default categories and starter inventory when the corresponding tables are empty.
- Uses Electron IPC to keep database work in the main process and exposes a limited API to the renderer through `preload.js`.
- The gear menu opens category configuration, About (current app version), and a manual Windows update workflow. Updates download only with consent and install only on an explicit restart.

## Coding Standards and Practices

- **Coding Style & Best Practices**: Adhere strictly to clean, modular, and efficient code practices. Avoid redundant logic and optimize for performance.
- **Naming Conventions**: Use highly descriptive, meaningful, and context-aware variable and function names. Avoid cryptic or single-letter abbreviations unless used as standard loop counters.
- **Documentation**: Include helpful, concise, and meaningful comments throughout the code to explain the "why" behind complex logic, rather than just stating what the code does. 

## Dependencies and commands

Declared in `package.json`:

| Package | Role | Declared range | Lockfile version |
|---|---|---:|---:|
| `electron` | Desktop runtime | `^31.0.0` (development dependency) | `31.7.7` |
| `better-sqlite3` | Synchronous SQLite database access | `^11.0.0` | `11.10.0` |
| `@electron/rebuild` | Rebuilds native modules for Electron | `^4.1.0` (development dependency) | `4.1.0` |
| `dotenv` | Environment configuration dependency | `^16.4.5` | `16.6.1` |
| `electron-updater` | Dependency for a future update workflow | `^6.3.9` | `6.8.11` |
| `dotenv-cli` | Loads local release environment variables | `^7.4.2` (development dependency) | `7.4.4` |
| `electron-builder` | Packages and publishes releases | `^24.13.3` (development dependency) | `24.13.3` |

No separate UI framework or runtime service is declared. `package-lock.json` records the rest of the transitive dependency tree.

| Command | Purpose |
|---|---|
| `npm start` | Launch the app with Electron |
| `npm run rebuild` | Rebuild `better-sqlite3` for the installed Electron runtime |
| `npm run pack` | Produce an unpacked build without publishing |
| `npm run dist` / `npm run build:local` | Build a universal Windows installer without publishing |
| `npm run build:release` | Build and publish the Windows installer to GitHub Releases using the local `.env` token |

There is currently no test or lint script in `package.json`.

## Database schema

SQLite is initialized in `database.js`; foreign-key enforcement is enabled.

### `instrument_models`

| Column | Type / constraint | Meaning |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Group identifier |
| `name` | `TEXT NOT NULL UNIQUE` | Instrument/model name |
| `category` | `TEXT` | Category name; currently stored as text, not a foreign key |

### `categories`

| Column | Type / constraint | Meaning |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Category identifier |
| `name` | `TEXT NOT NULL UNIQUE` | Editable category name |

### `individual_items`

| Column | Type / constraint | Meaning |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Individual asset identifier |
| `model_id` | `INTEGER`, foreign key to `instrument_models(id) ON DELETE CASCADE` | Parent group |
| `asset_tag_number` | `TEXT NOT NULL` | Physical tag number; unique only within a model |
| `asset_tag_name` | `TEXT` | Display name for the tagged item |
| `resource_title` | `TEXT NOT NULL DEFAULT ''` | Optional individual item description, including existing teacher-text titles |
| `purchase_date` | `TEXT` | Purchase date, represented in the UI as ISO `YYYY-MM-DD` |
| `status` | `TEXT DEFAULT 'Good'` | Condition/status; other status text is used for repair-needed items |
| `repair_notes` | `TEXT DEFAULT ''` | Item repair details |

The table has a composite `UNIQUE(model_id, asset_tag_number)` constraint. The category name on `instrument_models` is not linked to `categories` by a database foreign key; category rename/delete rules are implemented in application logic.

### `repair_log`

| Column | Type / constraint | Meaning |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Repair log entry identifier |
| `item_id` | `INTEGER NOT NULL`, foreign key to `individual_items(id) ON DELETE CASCADE` | Individual item whose repair is recorded |
| `entry_date` | `TEXT` | Repair date in ISO `YYYY-MM-DD` form |
| `description` | `TEXT NOT NULL DEFAULT ''` | Completed repair description |

Entries are ordered by `entry_date` descending, then `id` descending for matching dates. Deleting an item or its group removes its repair entries. Marking an item `Good` clears its current repair notes, but not its repair history.

**Initialization and migration notes**

- `database.js` inserts the default category list when `categories` is empty and starter instrument/item rows when `instrument_models` is empty.
- A migration adds `asset_tag_name` to older `individual_items` tables and fills it from the related model name.
- A second migration rebuilds older item tables that used a globally unique asset tag, applies per-model uniqueness, and cleans legacy tag strings when a trailing number can be extracted.
- A migration adds `resource_title` to older databases; existing items start with an empty title.
- The `repair_log` table is created if absent after the item-table migrations.
- Migration backups are copied to `inventory_backup.db` alongside the active database.

## Session log (append-only)

### 2026-11-10 — Established this context ledger

- Reviewed the app manifest, Electron main/preload/renderer files, UI markup, and SQLite initialization/migrations.
- Added this document as a project reference; no application code or database was changed.
- The workspace does not expose Git history, so this is the latest verifiable session entry, not a reconstruction of prior commits. Append future dated entries here as work is completed.

**Future entry format:** `YYYY-MM-DD — Short change title`, followed by concise bullets for files/behavior changed, checks run, and any follow-up.

### 2026-11-10 — Added editable Teacher Texts resource titles

- Added a per-item `resource_title` database column with a migration for existing databases.
- Teacher Texts item cards now show an editable title input below the item name/tag; edits save to SQLite when the field changes.
- Added the item-title update to the preload API and Electron IPC handler.
- Validation: JavaScript syntax checks passed; isolated migration and title-write checks passed for both supported legacy item-table layouts using the Electron runtime.

### 2026-11-10 — Grouped inventory cards under collapsible categories

- Grouped dashboard instrument cards beneath bold category headers that start collapsed and expand on click.
- Preserved expanded categories across dashboard refreshes and retained existing item-card actions.
- Added button semantics, `aria-expanded` state, and focus styling for keyboard accessibility.
- Validation: `node --check .\renderer.js` passed; reviewed the category toggle and existing item-card click delegation.

### 2026-11-10 — Open item details from anywhere on an inventory card

- Updated delegated card clicks so title, quantity, status, and whitespace all open the item detail list.
- Kept the edit pencil as a separate action using a closest-element check.
- Validation: `node --check .\renderer.js` passed.

### 2026-11-10 — Added independent scrolling to inventory panels

- Made the dashboard columns fill the available window height while keeping the page header stationary.
- Enabled independent vertical scrolling for the category inventory and selected-item detail list.
- Validation: reviewed the flex sizing and overflow rules on both scroll regions; no automated UI test is configured.

### 2026-11-10 — Renamed the add-inventory section

- Changed the section title to “Add New Inventory Item.”

### 2026-11-10 — Expanded individual descriptions and added repair history

- Extended the existing `resource_title` field to all individual item cards; its placeholder is “Add desc, brand, color etc”. Existing Teacher Texts values remain in the same column.
- Added reusable `EDITABLE_FIELDS` configuration and an auto-growing textarea helper in `renderer.js`. Description and repair log text areas wrap, resize with the window, and use Enter to leave the field; saved text is trimmed at its edges.
- Added the `repair_log` table, preload API, and IPC handlers. Each item has a Repair log with a plus button, editable description, and date picker defaulting to today. Entries save when leaving the entry or pressing Enter, and sort newest repair date first, with newer IDs first on the same date.
- Moved the Mark Broken/Mark Fixed button alongside the status and the individual-item trash button to the card's upper-right corner.
- Replaced delete confirmations and renderer alerts with main-process Electron dialogs. After a full restart, the user confirmed the previously unresponsive trash button was fixed. A full app restart is required after changes to `app.js` or `preload.js`; reloading the window alone does not reload them.
- Validation during these changes consisted of JavaScript syntax checks and a fresh Electron-instance check of the delete button click target and dialog bridge; a completed delete was not exercised in that automated check.

### 2026-11-10 — Prepared Windows builds and GitHub releases

- Added electron-builder configuration for a single x64/ARM64 Windows installer, GitHub release publishing, and a future `electron-updater` integration. Automatic update checks and installation are not yet implemented.
- Added a root `.env` for `GH_TOKEN`, an `.env.example`, and `.gitignore` rules for secrets, databases, dependencies, and build output. See `README.md` for release prerequisites; the planned public repository `pconniff1-tech/Elementary-Music-Room-Inventory` still needs to be created.
- Installed builds store the database and migration backup in per-user application data, separate from the development database. A new empty database is seeded with editable example inventory and default categories.
- The Windows build script restores the development machine's native dependencies after packaging. Validation: universal installer built successfully, native modules matched both target architectures, and an isolated packaged database initialized example data and accepted a write.

### 2026-11-10 — Added manual update checks

- Added the gear menu, current-version About dialog, and manual check/download/restart workflow using `electron-updater`. The existing category configuration modal remains available from the menu.
- Update downloads and installation require explicit user actions; checks are supported in installed Windows builds, not development mode.
- Validation: updater controller tests and an Electron UI smoke test exercise the workflow with a simulated updater. An x64 NSIS build included the updater and GitHub update configuration. A real published update still requires end-to-end testing against a newer GitHub release.

## Issues fixed log

The source contains these implemented corrections/migrations. Their original dates and release versions are not available in the workspace.

| Issue / correction | Evidence in current code |
|---|---|
| Older databases lacked an individual-item display name. | Migration adds `asset_tag_name` and backfills names from `instrument_models`. |
| Asset tag numbers were previously globally unique and could contain model names. | Migration changes uniqueness to per-model and cleans values with a trailing number. |
| Adding items to a group with deleted tag-number gaps could skip reusable numbers. | The `update-instrument-group-in-db` handler fills unused positive numbers before extending the set. |
| Renaming a group could leave existing item display names stale. | The group update handler updates `individual_items.asset_tag_name` with the group name. |
| Deleting a category still in use could leave groups pointing to a deleted category. | `deleteCategory` rejects deletion while groups use that category. |
| Marking an item back to `Good` could retain outdated repair notes. | The status IPC handler clears `repair_notes` when setting status to `Good`. |
| Starter headphone items needed the correct model foreign key. | Starter-data insertion passes the headphone model ID directly to item insertion. |

## Next steps / to-dos

1. **Test a real published update** from an older installed build to a newer GitHub release.
2. **Add automated database tests** for CRUD behavior, category rules, tag-number allocation, and all database migrations; add a test command to `package.json`.
3. **Define and test a backup/restore workflow.** Current backups are migration-triggered and kept beside the active database; no routine backup or restore UI is present.
4. **Validate IPC payloads in the main process.** Check required text, quantity bounds, dates, status values, and referenced IDs before database writes.

## Source map

- `package.json` — app metadata, dependency ranges, npm scripts.
- `app.js` — Electron window setup and IPC request handlers.
- `preload.js` — renderer-safe `inventoryAPI` bridge.
- `renderer.js` and `index.html` — inventory UI and interactions.
- `updates.js` — manual updater state and actions in the main process.
- `database.js` — SQLite schema, seed data, migrations, and database helpers.
- `scripts/build-windows.js` — Windows packaging and restoration of development native dependencies.
- `README.md` — development, installer, and release instructions.