# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run test     # Run tests with vitest
npm run preview  # Preview production build
```

## Architecture

Monster MQTT Explorer is a high-performance MQTT client with topic tree visualization, built as a PWA with **Solid.js**, **Tailwind CSS v4**, and **Vite**.

### Key Design Decisions

- **MQTT runs in a Web Worker** (`src/workers/mqtt.worker.ts`) to keep the UI thread free. The worker batches incoming messages every ~16ms and uses transferable `Uint8Array` payloads for zero-copy transfer to the main thread.
- **Virtual scrolling** via `@tanstack/solid-virtual` renders the topic tree efficiently for large topic counts.
- **Solid.js stores** (not signals alone) manage state — `connections`, `topics`, and `ui` stores live in `src/stores/` and use `produce()` for nested reactive updates.
- **Topic tree is hierarchical** — messages are inserted into a segment-based tree (`TopicNode` with `children: Record<string, TopicNode>`), not stored in a flat map.

### Data Flow

```
MQTT Broker → Worker (batches msgs) → App (processBatch) → topicTree store → UI reactivity
User actions → App → postMessage to worker (connect/disconnect/subscribe/publish)
```

### Source Layout

- `src/App.tsx` — Main layout, worker lifecycle, resizable split pane
- `src/stores/` — Three stores: `connections.ts` (CRUD + persistence), `topics.ts` (tree + message rate), `ui.ts` (selection, expansion, modals)
- `src/workers/` — `mqtt.worker.ts` (MQTT client + batching) and `mqtt.protocol.ts` (worker message types)
- `src/lib/` — `topic-tree.ts` (insert, flatten for virtualization, lookup), `format.ts` (payload display), `persistence.ts` (API calls)
- `src/components/` — Organized by feature: `layout/`, `connection/`, `tree/`, `detail/`
- `src/types/mqtt.ts` — Core types: `ConnectionConfig`, `TopicNode`, `MqttMessage`
- `server/api.ts` — Simple REST API for connection persistence (`GET/PUT /api/connections`), served via Vite dev middleware plugin in `vite.config.ts`

### Styling

Dark theme using Tailwind utilities. Custom color `slate-850` and a `row-flash` animation defined in `src/global.css`. JSX uses `solid-js` pragma (`tsconfig.json` → `jsxImportSource: "solid-js"`).
