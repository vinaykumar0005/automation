# Claude Automation App

## Project Overview

This is an Electron-based automation application built with React, TypeScript, and Tailwind CSS. The application provides browser automation capabilities with features like tab management, task execution, proxy management, and logging.

## Project Structure

```
.
├── src/
│   ├── main/                 # Main process (Electron main)
│   │   ├── automation/       # Browser automation controllers
│   │   │   ├── BrowserController.ts   # Main controller: tabs, tasks, proxies, profiles
        │   │   ├── TabManager.ts      # Manages browser tabs
        │   │   ├── TaskQueue.ts       # Per-tab task queuing system
        │   │   ├── ProxyManager.ts    # Proxy management and rotation
        │   │   ├── types.ts           # Shared TypeScript types (re-exports shared/types)
        │   │   └── plugins/           # Task plugin system
        │   │       ├── basePlugin.ts       # IPlugin / ITaskHandler interfaces
        │   │       ├── pluginManager.ts    # Dynamic plugin directory loader
        │   │       └── built-in/           # navigate, click, fillForm, extractText,
        │   │                              # waitForSelector, loopVideo, watchDuration,
        │   │                              # checkIpLeak, screenshot
        │   ├── config/                # App configuration service (defaults/env/file merge)
        │   │   ├── configService.ts
        │   │   └── configTypes.ts
        │   ├── monitoring/            # Metrics, health checks, tracing
        │   │   ├── metricsCollector.ts
        │   │   ├── healthChecker.ts
        │   │   ├── traceManager.ts
        │   │   └── types.ts
        │   ├── index.ts               # Entry point for main process
        │   ├── ipc/                   # IPC handlers
        │   │   ├── channels.ts        # Re-exports shared/ipc-channels
        │   │   └── handler.ts         # IPC handler registration
        │   └── logging/               # Logging configuration
        │       └── logger.ts
        │
        ├── preload/                   # Preload script (context bridge)
        │   ├── index.ts
        │   └── tsconfig.json
        │
        ├── renderer/                  # Renderer process (React UI)
        │   ├── App.tsx                # Root React component
        │   ├── main.tsx               # React entry point
        │   ├── components/            # React components
        │   │   ├── ControlPanel.tsx   # Control panel UI
        │   │   ├── ProxyPanel.tsx     # Proxy management UI
        │   │   ├── TaskPanel.tsx      # Task management UI
        │   │   ├── TabCard.tsx        # Individual tab card
        │   │   ├── TabGrid.tsx        # Grid of tabs
        │   │   ├── LogConsole.tsx     # Log display
        │   │   ├── AnalyticsPanel.tsx # Runtime/health/task metrics dashboard
        │   │   ├── AdvancedPanel.tsx  # Persisted browser/automation settings
        │   │   └── ProfilePanel.tsx   # Profile CRUD, import/export, run/restart, history
        │   ├── hooks/                 # Custom React hooks
        │   │   └── useAutomationApi.ts # Hook to access automation API
        │   ├── state/                 # Zustand store
        │   │   └── store.ts
        │   ├── global.d.ts            # Global TypeScript declarations
        │   ├── index.css              # Global CSS
        │   └── index.html             # HTML template
        │
        ├── shared/                    # Shared types between main and renderer
        │   ├── ipc-channels.ts        # IPC channel definitions (single source of truth)
        │   └── types.ts               # Shared TypeScript interfaces, incl. ProxyRotationStrategy
        │
        ├── build/                     # Built output (generated)
        │
        ├── electron-builder.yml       # Electron builder configuration
        ├── electron-builder/          # Electron builder customizations
        ├── scripts/                   # Build scripts
        │   └── build.mjs
        ├── logs/                      # Log files
        ├── node_modules/
        ├── package.json
        ├── package-lock.json
        ├── tsconfig.json              # Base TypeScript config
        └── vite.config.js             # Vite configuration for renderer
```

Note: `src/main/config` and `src/main/monitoring` are imported from `src/main/automation/BrowserController.ts` using `../config/...` and `../monitoring/...` — always one level up from `automation/`, not two. A previous refactor briefly had this wrong and a stray `src/monitoring/types.ts` (outside `main/`) was created while chasing the resulting build error; that stray file has been removed. If you see "Could not resolve" errors on these imports, check the relative path depth first.

## Key Components

### Main Process (Electron Main)
- `src/main/index.ts`: Entry point, creates the BrowserWindow and initializes the application
- `src/main/automation/BrowserController.ts`: Main controller that manages tabs, tasks, and proxies
- `src/main/automation/TabManager.ts`: Manages browser tab lifecycle
- `src/main/automation/TaskQueue.ts`: Queues and executes tasks on tabs
- `src/main/automation/ProxyManager.ts`: Manages proxy configuration and rotation
- `src/main/ipc/`: Handles inter-process communication between main and renderer processes

### Preload Script
- `src/preload/index.ts`: Exposes the automation API to the renderer via `contextBridge`

### Renderer Process (React)
- `src/renderer/App.tsx`: Main application layout
- Components:
  - `ControlPanel`: Main controls for the application
  - `ProxyPanel`: Proxy configuration and management
  - `TaskPanel`: Task creation and management
  - `TabGrid`: Grid display of browser tabs
  - `LogConsole`: Display of application logs
- `src/renderer/hooks/useAutomationApi.ts`: Custom hook to access the automation API from the renderer

### Shared Types
- `src/shared/types.ts`: TypeScript interfaces shared between main and renderer processes
- `src/shared/ipc-channels.ts`: IPC channel definitions

## Development Setup

1. **Prerequisites**:
   - Node.js (v16+ recommended)
   - npm or yarn

2. **Installation**:
   ```bash
   npm install
   ```

3. **Proxy File Support** (New Feature):
   - Place a `proxies.txt` file in the application root directory (same level as package.json)
   - Format: one proxy per line in CSV format:
     - `label,server,username,password` (all fields)
     - `server` only (label auto-generated, no auth)
   - Example:
     ```
     US-East,http://12.34.56.78:8080,user1,pass1
     socks5://98.76.54.32:1080
     ```
   - Proxies are automatically loaded on application startup with round-robin rotation
   - If proxies.txt is not found, the application starts with no proxies (existing behavior)

4. **Development Scripts**:
   - `npm run dev`: Starts the application in development mode
     - Starts Vite dev server (port 5173)
     - Starts Electron backend in watch mode
     - Launches Electron with React dev tools
   - `npm run dev:renderer`: Starts only the Vite dev server
   - `npm run dev:backend`: Starts the Electron backend in watch mode
   - `npm run dev:electron`: Launches Electron pointing to the dev server

5. **Type Checking**:
   - `npm run typecheck`: Runs TypeScript type checking for all processes
   - `npm run typecheck:main`: Main process type checking
   - `npm run typecheck:preload`: Preload script type checking
   - `npm run typecheck:renderer`: Renderer process type checking

## Available Scripts

```json
{
  "dev:renderer": "vite",
  "dev:backend": "node scripts/build.mjs --watch",
  "dev": "concurrently \"npm run dev:renderer\" \"npm run dev:backend\" \"npm run dev:electron\"",
  "dev:electron": "wait-on http://localhost:5173 build/main/index.js && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron .",
  "build:renderer": "vite build",
  "build:backend": "node scripts/build.mjs",
  "build": "npm run build:renderer && npm run build:backend",
  "typecheck": "npm run typecheck:main && npm run typecheck:preload && npm run typecheck:renderer",
  "typecheck:main": "tsc -p src/main/tsconfig.json",
  "typecheck:preload": "tsc -p src/preload/tsconfig.json",
  "typecheck:renderer": "tsc -p src/renderer/tsconfig.json",
  "dist": "npm run build && electron-builder"
}
```

## Technology Stack

- **Main Process**: Electron, TypeScript
- **Renderer Process**: React, TypeScript, Tailwind CSS
- **Build Tool**: Vite (for React), esbuild (for Electron main/preload)
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Browser Automation**: Playwright
- **Logging**: Winston
- **Proxy Management**: Custom implementation with proxies.txt file support
- **Electron Builder**: For packaging the application
- **Concurrently**: For running multiple processes during development
- **Wait-on**: For waiting on dependencies before launching Electron

## Coding Guidelines

### TypeScript
- Strict mode is enabled in all tsconfig files
- Use interfaces for object shapes, types for unions/intersections
- Prefer functional components with hooks in React
- Use async/await for asynchronous operations

### React
- Functional components with hooks
- Use Tailwind CSS for styling
- Components should be small and focused
- Use the `useAutomationApi` hook to access the automation API from renderer components

### IPC Communication
- All IPC channels are defined in `src/shared/ipc-channels.ts`
- Use the `contextBridge` in the preload script to expose a safe API to the renderer
- The main process handles all browser automation logic
- The renderer process only handles UI and user interactions

### Logging
- Uses Winston logger (`src/main/logging/logger.ts`)
- Logs are written to the `logs/` directory
- Different log levels: error, warn, info, debug, etc.

### Proxy System
- Supports multiple proxy configurations
- Rotation strategies: round-robin, random, sticky-per-tab
- Proxy status tracking including failed proxies

### Task System
- Tasks are queued per tab
- Broadcast tasks can run on multiple tabs simultaneously
- Tasks are defined by type and payload

## Building for Production

```bash
npm run dist
```

This will:
1. Build the React renderer with Vite
2. Build the Electron main and preload processes with esbuild
3. Package the application using Electron Builder

The packaged application will be available in the `dist/` directory.

## Additional Notes

- The application uses a single-window approach
- Browser instances are managed by Playwright through the BrowserController
- Tabs are individual BrowserWindow instances (or BrowserViews, depending on implementation)
- The application is designed to be extensible for additional automation tasks
- Error handling is centralized in the BrowserController and propagated via IPC events
- Security features like context isolation and sandboxing are enabled in the BrowserWindow