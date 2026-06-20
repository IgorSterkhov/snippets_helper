# ClickHouse Update Progress Spec

## Goal

Make ClickHouse Docs updates observable while they run, without freezing the UI and without losing progress when the user switches to another module and comes back.

## Requirements

- The Update action must show a dedicated status bar in the ClickHouse module.
- The status bar must show current phase, current/total source pages, remaining count, percentage, and elapsed time while parsing is running.
- The native update must continue even if the user leaves the ClickHouse tab.
- Returning to the ClickHouse tab must restore the current update snapshot from native state.
- At completion, the status bar must show the result summary, last update time, page/section counts, failure count, and duration.
- Concurrent updates are not allowed; if one is already running, the UI should keep showing the existing progress instead of starting a duplicate.

## Design

The Tauri command owns the update lifecycle. It stores the current/last progress snapshot in a managed in-memory state and emits `clickhouse-doc-update-progress` events after each meaningful transition. The frontend subscribes to the event when the module is active and also calls `get_clickhouse_doc_update_progress` on init, so progress survives tab switches.

The existing update history tables remain the durable changelog. Progress state is intentionally process-local because it represents an active operation, not a historical record.

## Out of Scope

- Full user-cancel support.
- Persisting in-progress state across application restarts.
- Parallel fetching. The initial implementation keeps the sequential fetch loop so the progress count stays deterministic and easy to reason about.
