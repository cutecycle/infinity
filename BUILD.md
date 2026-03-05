# Infinity Chrome Extension - Build Setup

## Overview

This document describes the build pipeline for the Infinity Chrome Extension. The project uses Webpack as the bundler to handle multiple entry points for different parts of the extension.

## Build Architecture

### Entry Points

The extension consists of four main entry points:

1. **Service Worker** (`src/service-worker.js`) - Background worker managing tab and window state
2. **Content Script** (`src/content-script.js`) - Script injected into web pages
3. **Popup** (`src/popup/index.js`) - Popup UI bundle
4. **Options** (`src/options/index.js`) - Options page UI bundle

### Build Output Structure

After building, the `dist/` folder contains:

```
dist/
├── manifest.json          # Extension manifest (copied from public/)
├── service-worker.js      # Bundled background worker
├── service-worker.js.map  # Source map for debugging
├── content-script.js      # Bundled content script
├── content-script.js.map  # Source map for debugging
├── popup.html             # Popup HTML (generated from template)
├── popup.js               # Popup bundle
├── popup.js.map           # Source map for debugging
├── options.html           # Options page HTML (generated from template)
├── options.js             # Options page bundle
├── options.js.map         # Source map for debugging
└── icons/                 # Extension icons (copied from public/icons, if exists)
```

## Configuration Files

### webpack.config.js

The Webpack configuration handles:

- **Mode Detection**: Production mode (minified, optimized) vs Development mode (with source maps)
- **Entry Points**: Defines the four main bundles
- **HTML Generation**: Uses `html-webpack-plugin` to generate popup.html and options.html
- **File Copying**: Uses `copy-webpack-plugin` to copy manifest.json and icons
- **Source Maps**: 
  - Production: `source-map` (separate files for best debugging)
  - Development: `eval-source-map` (faster rebuilds)
- **Path Aliases**: 
  - `@utils` → `src/utils/`
  - `@types` → `src/types/`

### package.json

Build scripts are defined in `package.json`:

```json
{
  "scripts": {
    "build": "webpack --mode production",
    "dev": "webpack --mode development --watch",
    "clean": "rimraf dist"
  }
}
```

### jsconfig.json

Provides IDE support for:

- Module resolution and path aliases
- Type hints with JSDoc comments
- ES6+ syntax support

### .eslintrc.json

ESLint configuration for code quality:

- Chrome extension environment setup
- WebExtensions API globals
- Recommended rules for consistency

## How to Use

### Installation

Install dependencies (required before building):

```bash
npm install
```

### Development Workflow

For development with watch mode:

```bash
npm run dev
```

This will:
- Start Webpack in watch mode
- Automatically rebuild when source files change
- Generate unminified bundles with source maps
- Keep previous builds for comparison

### Production Build

For production release:

```bash
npm run build
```

This will:
- Create an optimized, minified build in `dist/`
- Generate source maps for debugging deployed code
- Copy all required files (manifest, icons)

### Cleaning

Remove all generated build artifacts:

```bash
npm run clean
```

This is useful before rebuilds to ensure a clean slate.

## Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist/` folder

## Module System

The project uses ES6 modules. Note that:

- Service Worker and Content Script can use `import` statements
- Webpack bundles them appropriately for Chrome's environment
- Cross-module imports work seamlessly

Example:

```javascript
// In src/content-script.js
import { initializeWakeListener, savePageState } from './utils/tab-wake.js';
```

## Path Aliases

You can use path aliases for cleaner imports:

```javascript
import { log } from '@utils/helpers.js';
import { MyType } from '@types/definitions.js';
```

These are automatically resolved by Webpack.

## Source Maps

Source maps are generated for all bundles:

- **Production**: Full source maps in separate `.map` files for production debugging
- **Development**: Inline source maps for fast rebuilds

View source maps in Chrome DevTools:
1. Open DevTools (F12)
2. Go to Sources tab
3. Click the toggle to show original source

## Dependencies

### Dev Dependencies

- **webpack** (v5.89.0): Module bundler
- **webpack-cli** (v5.1.4): CLI for Webpack
- **clean-webpack-plugin** (v4.0.0): Clean dist folder before builds
- **copy-webpack-plugin** (v11.0.0): Copy static assets
- **html-webpack-plugin** (v5.6.0): Generate HTML files
- **css-loader** (v6.8.1): Process CSS imports
- **style-loader** (v3.3.3): Inject CSS into DOM
- **eslint** (v8.55.0): Linting for code quality
- **rimraf** (v5.0.5): Cross-platform file deletion
- **@types/chrome** (v0.0.260): TypeScript types for Chrome API

## Common Issues

### Build fails with "Cannot find module"

Check that:
- The file path is correct (case-sensitive on some systems)
- The file exists in the src/ directory
- You've run `npm install` to get dependencies

### Changes not reflecting in dist/

For dev mode:
- Check that `npm run dev` is still running
- Webpack may be watching but not rebuilt - try saving again
- Check console for build errors

For production:
- Run `npm run clean && npm run build` for a fresh build

### Extension not loading in Chrome

Ensure:
- `dist/manifest.json` exists and is valid JSON
- All required files (`service-worker.js`, `content-script.js`, HTML files) are present
- You're loading the correct `dist/` folder

### Source maps not working

- In dev mode, source maps should be inline and automatic
- In prod mode, `.map` files should be in the `dist/` folder
- Check Chrome DevTools Settings → Sources → Enable JavaScript source maps

## Next Steps

1. Load the extension in Chrome (see "Loading the Extension in Chrome" above)
2. Test each component:
   - Service Worker: Check DevTools → Extensions → Background
   - Content Script: Inject on any webpage and check console
   - Popup: Click extension icon to test popup.html
   - Options: Right-click extension → Options to test

3. Modify source files in `src/` and watch for automatic rebuilds

## Reference Documentation

- [Webpack Documentation](https://webpack.js.org/)
- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Guide](https://developer.chrome.com/docs/extensions/mv3/)
