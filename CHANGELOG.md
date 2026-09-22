# Changelog

All notable changes to Top Note are documented here.

## [1.1.0]

### Added — Project Planning & Task Management

A full project-planning workspace, separate from note-taking, reachable from the new "วางแผนโปรเจกต์" button in the sidebar:

- **Projects**: create/edit/delete, with name, description, start/end dates, owner, and status (Planning / In Progress / On Hold / Completed).
- **Tasks**: nested tasks/subtasks and milestones, each with assignee, priority, status, progress %, notes, and Finish-to-Start dependencies (with cycle detection and an "at risk" indicator when a predecessor slips).
- **Four synchronized views** on the same task data — Overview (progress stats), Task List, Kanban Board, and a custom-built interactive Gantt chart (Day/Week/Month zoom, drag to move/resize, dependency arrows, today marker, overdue highlighting, a simplified list on mobile).
- Built with no new dependencies — the Gantt chart and Kanban drag-and-drop are hand-rolled with native Pointer/Drag-and-Drop events, consistent with the rest of the app.

### Added — Drag-to-reorder and Favorites

- Categories, notes (opt-in via a new "เรียงลำดับเอง" sort toggle), projects, and tasks can all be reordered by dragging.
- A Favorites star is available on notes, categories, projects, and tasks; favorited items are pinned to the top of their list. Notes also get a dedicated "รายการโปรด" (Favorites) filter in the sidebar.

### Changed

- The Planning entry point moved to the top of the sidebar, next to "สร้างโน้ตใหม่", so it's easier to find.

### Fixed

- `src/supabase.ts` accessed `window` unguarded at module load, which crashed on import outside a browser context (e.g. the unit test runner). It now falls back to `undefined` when `window` isn't available.

## [1.0.0]

- Initial release: Google sign-in via Supabase, cloud-synced notes and categories, Tiptap editor, AI summaries scoped to selection, ZIP backup/import, PWA install, Windows desktop installer.
