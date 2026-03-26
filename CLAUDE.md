# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev               # Start dev server (port 3000)
npm run build             # Production PWA build
npm run build:pwa         # PWA build with version bump
npm run build:electron    # Electron build (all platforms)
npm run build:electron:mac  # Electron build for macOS (DMG)
npm run build:electron:win  # Electron build for Windows (NSIS)
npm run test              # Run tests with vitest (watch mode)
npx vitest run <file>     # Run a single test file once
npm run preview           # Preview production build
```

## Architecture

Monster MQTT Explorer is a high-performance MQTT/WinCC client with topic tree visualization, built as a PWA and Electron app using **Solid.js**, **Tailwind CSS v4**, and **Vite**.

### Connection Types

Three connection types share the same `ConnectionConfig` shape and worker protocol:
- **`mqtt`** — standard MQTT over WebSocket; topics are prefixed with the connection name on arrival
- **`winccua`** — WinCC Unified (Siemens) via GraphQL WebSocket (`winccua.worker.ts` + `src/lib/winccua-api.ts`)
- **`winccoa`** — WinCC OA (Siemens) via GraphQL WebSocket (`winccoa.worker.ts` + `src/lib/winccoa-api.ts`)

Each connection spawns its own Web Worker. Workers batch incoming messages every ~16ms and send `Uint8Array` payloads as transferable objects (zero-copy).

### Data Flow

```
Broker/Server → Worker (batches msgs) → App.setupWorkerListeners
  → processBatch (topicTree store) + addMessages (messageLog store)
  → UI reactivity (TopicTree, MessageTable, MessageDetail)

User actions → App → postMessage to worker (connect/subscribe/publish/unsubscribe)
```

### Stores (`src/stores/`)

All stores are module-level singletons (signals/stores created once, not per-component). Import via their `useX()` hook:

- **`connections.ts`** — `ConnectionConfig[]` CRUD + active connection id. Persists to IndexedDB via `idb-keyval`. Falls back to `/api/connections` (REST) only for one-time migration from older versions.
- **`topics.ts`** — The `topicTree` store: a `TopicNode` tree updated via `produce()` on every batch. Also tracks message rate.
- **`messageLog.ts`** — Two parallel views of incoming messages: `liveTopics` (one `LoggedMessage` per topic, id stable across updates) and `logMessages` (append-only history, trimmed to `logMaxRows`). Mode toggled by user between "live" and "history".
- **`ui.ts`** — UI-only state: selected topic, expanded nodes, modal visibility, flash animation toggle, connection statuses. Also stores publish/subscribe/unsubscribe function refs so components can call them without prop-drilling.
- **`watchlist.ts`** — Pinned ("sticky") topics and named saved watchlists. Both persisted to IndexedDB.

### Key Design Decisions

- **Virtual scrolling** via `@tanstack/solid-virtual` in both `TopicTree` and `MessageTable` (single-line mode). Multi-line mode in `MessageTable` uses a plain `<For>` loop.
- **Topic tree is hierarchical** — `TopicNode` with `children: Record<string, TopicNode>`. Leaf nodes hold `lastMessage`; intermediate/parent nodes do not (their `lastMessage` is always `null`).
- **Message table row selection** — In live mode, selection is stored as `selectedLiveTopic` (topic string) and re-derived reactively from `liveTopics[topic]`. In history mode, selection is stored as a frozen `LoggedMessage` snapshot. This distinction matters: live detail auto-updates on new payloads; history detail stays frozen.

### Solid.js Reactivity Pitfall

**Always use `on(signal, fn)` when a `createEffect` body accesses stores that change frequently** (e.g., `topicTree`). Without `on()`, every store property read inside the effect body creates a reactive dependency. For example, calling `getNodeByTopic(topicTree, topic)` inside a bare `createEffect` will re-run the effect on every incoming message, not just on the intended trigger. `on()` wraps the body in `untrack`, so only the explicit deps trigger re-runs. This pattern is used in `DetailPane.tsx` for the mode-switch effect.

### Persistence

All persistence uses `idb-keyval` (IndexedDB). Keys:
- `monster-mqtt-explorer.connections`
- `monster-mqtt-explorer.watchlists`
- `monster-mqtt-explorer.pinnedTopics`

The REST API (`server/api.ts`, served via Vite middleware in `vite.config.ts`) is only used during the initial migration when no IndexedDB data exists.

### Styling

Dark theme using Tailwind utilities. Custom color `slate-850` and a `row-flash` animation defined in `src/global.css`. JSX uses `solid-js` pragma (`tsconfig.json` → `jsxImportSource: "solid-js"`).
