# Infinity Chrome Extension

A Chrome extension for efficient tab and window management.

## Project Structure

```
infinity/
├── src/
│   ├── service-worker.js    # Background service worker
│   ├── content-script.js    # Content script for page injection
│   └── utils.js             # Utility functions
├── popup/
│   ├── popup.html           # Popup UI
│   ├── popup.js             # Popup logic
│   └── popup.css            # Popup styling
├── options/
│   ├── options.html         # Options page UI
│   ├── options.js           # Options page logic
│   └── options.css          # Options page styling
├── public/
│   └── manifest.json        # Manifest V3 configuration
├── icons/
│   ├── 16.png              # Extension icon (16x16)
│   ├── 48.png              # Extension icon (48x48)
│   └── 128.png             # Extension icon (128x128)
├── package.json
├── .gitignore
└── README.md
```

## Development

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

```bash
npm install
```

### Development Build

Watch mode for continuous compilation:
```bash
npm run dev
```

### Production Build

Create optimized build:
```bash
npm run build
```

### Type Checking

Verify TypeScript types:
```bash
npm run type-check
```

### Linting

Check code quality:
```bash
npm run lint
```

## Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top-right corner)
3. Click "Load unpacked"
4. Select the project root directory

## Features

- Tab management
- Window tracking
- Local storage
- Offscreen document support for screenshots
- Popup interface for quick access
- Options page for configuration

## Manifest V3

This extension uses Chrome's Manifest V3:
- Service Worker background script (no background page)
- Content scripts for page interaction
- Action popup for user interface
- Options page for settings
- Storage API for data persistence

## Permissions

- **tabs**: Read tab information and manage tabs
- **windows**: Manage browser windows
- **storage**: Access local storage API
- **offscreen**: Create offscreen documents
- **scripting**: Inject scripts into pages
