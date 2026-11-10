# Music Room Inventory

## Development

Install dependencies with `npm install` and run the app with `npm start`.
The development app uses `inventory.db` in the project directory. Database
files and local environment files are excluded from Git.

## Windows builds and releases

Run `npm run build:local` to build a single Windows installer for both x64
and ARM64 in `dist`. The build restores native dependencies for the
development machine afterward. The installed app starts with example inventory
and default categories in Electron's per-user application data directory; it
does not include the development database. Uninstalling the app retains this data.

To publish, first create the public GitHub repository
`pconniff1-tech/Elementary-Music-Room-Inventory`, update the version in
`package.json`, and put a GitHub token with repository Contents read/write
permission in the root `.env` as `GH_TOKEN=...`. Keep this token private.
Then run `npm run build:release`; electron-builder builds the universal installer
and publishes it to GitHub Releases. Git and a valid tag for the version are
required for release publishing.

In an installed Windows app, use the gear menu's **Check for Updates** option
to check the public GitHub releases. If a newer release is available, choose
**Update Now** to download it or **Update Later** to defer. Once downloaded,
choose **Restart to Update** to install and restart. Closing the dialog does
not install the update; open Check for Updates again to return to its status.
Update checks are not supported in development mode. Releases must include
electron-builder's update metadata and installer, and have a newer version
than the installed app. The `.env` file is for local publishing and is not
included in installers.
