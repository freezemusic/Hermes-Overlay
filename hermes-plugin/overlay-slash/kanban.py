"""Authenticated kanban proxy for the overlay.

The handlers call ``hermes_cli.kanban_db`` the same way
``plugins/kanban/dashboard/plugin_api.py`` does. There is no shell-out.
When that module is missing, every route returns 404 ``kanban unavailable``.
"""

from __future__ import annotations

import sqlite3
from contextlib import nullcontext
from typing import Any, Callable, Mapping

try:
    from . import commands
except ImportError:  # plugin directory on sys.path
    import commands

# Overlay lanes, in dashboard order. ``scheduled`` and ``review`` are real
# Hermes columns; they are appended only when a task sits in one, so a card
# is not dropped. ``archived`` is not a lane (see include_archived).
BOARD_COLUMNS = ("triage", "todo", "ready", "running", "blocked", "done")
EXTRA_COLUMNS = ("scheduled", "review")
# Statuses a human may set. ``running`` is dispatcher-only; archive/delete
# are not this API.
PATCH_STATUSES = frozenset({"triage", "todo", "ready", "blocked", "done", "scheduled", "review"})
RECENT_EVENTS = 50

_KB_NAMES = (
    "connect", "init_db", "get_current_board", "list_boards", "list_tasks", "get_task",
    "parent_ids", "child_ids", "list_comments", "list_events", "assign_task", "edit_task",
    "complete_task", "block_task", "unblock_task", "reopen_review_task", "schedule_task",
    "request_review", "write_txn",
)


class KanbanHTTP(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def match(method: str, path: str) -> tuple[str, str] | None:
    """``(kind, task_id)`` for an overlay kanban route, else None."""
    base = "/v1/overlay/kanban"
    if path == base + "/board" and method == "GET":
        return ("board", "")
    if path == base + "/boards" and method == "GET":
        return ("boards", "")
    prefix = base + "/tasks/"
    if path.startswith(prefix) and method in {"GET", "PATCH"}:
        task_id = path[len(prefix):]
        if task_id and "/" not in task_id:
            return ("task" if method == "GET" else "patch", task_id)
    return None


def available() -> bool:
    """True when the gateway process can import the kanban DB helpers."""
    needed = ("connect", "list_tasks", "get_task")
    return all(_symbol(name) is not None for name in needed)


def _symbol(name: str) -> Callable | None:
    return commands.load_symbol("hermes_cli.kanban_db", name)


def _kb() -> dict[str, Any]:
    return {name: _symbol(name) for name in _KB_NAMES}


def _require_kb() -> dict[str, Any]:
    found = _kb()
    if found["connect"] is None or found["list_tasks"] is None or found["get_task"] is None:
        raise KanbanHTTP(404, "kanban unavailable")
    return found


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, Mapping):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, Mapping):
        return dict(obj)
    data = getattr(obj, "__dict__", None)
    if isinstance(data, dict):
        return {key: value for key, value in data.items() if not key.startswith("_")}
    return {}


def _flag(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _call(fn: Callable, *args: Any, **kwargs: Any) -> Any:
    accepted = {key: value for key, value in kwargs.items() if commands.accepts_param(fn, key)}
    return fn(*args, **accepted)


def _open(kb: dict[str, Any], board: str | None) -> Any:
    init = kb.get("init_db")
    if init is not None:
        try:
            _call(init, board=board)
        except KanbanHTTP:
            raise
        except Exception as exc:
            message = str(exc).lower()
            if "does not exist" in message or "archived" in message:
                raise KanbanHTTP(404, "board not found") from exc
            commands.warn_once("kanban-init", f"overlay-slash: kanban init_db failed ({exc})")
    try:
        return _call(kb["connect"], board=board)
    except KanbanHTTP:
        raise
    except Exception as exc:
        message = str(exc).lower()
        if "does not exist" in message or "archived" in message or "no such" in message:
            raise KanbanHTTP(404, "board not found") from exc
        raise


def _close(conn: Any) -> None:
    close = getattr(conn, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def _ids(conn: Any, kb: dict[str, Any], task_id: str, which: str) -> list[str]:
    fn = kb.get("parent_ids" if which == "parents" else "child_ids")
    if fn is not None:
        try:
            found = fn(conn, task_id) or []
            return [str(item) for item in found]
        except Exception as exc:
            commands.warn_once(f"kanban-{which}", f"overlay-slash: kanban {which} failed ({exc})")
    column, other = ("parent_id", "child_id") if which == "parents" else ("child_id", "parent_id")
    try:
        rows = conn.execute(
            f"SELECT {column} FROM task_links WHERE {other} = ? ORDER BY {column}",
            (task_id,),
        ).fetchall()
    except Exception:
        return []
    out: list[str] = []
    for row in rows:
        if isinstance(row, sqlite3.Row) or isinstance(row, Mapping):
            out.append(str(row[column]))
        else:
            out.append(str(row[0]))
    return out


def _event_stamps(conn: Any) -> dict[str, int]:
    try:
        rows = conn.execute(
            "SELECT task_id, MAX(created_at) AS ts FROM task_events GROUP BY task_id"
        ).fetchall()
    except Exception:
        return {}
    stamps: dict[str, int] = {}
    for row in rows:
        if isinstance(row, sqlite3.Row) or isinstance(row, Mapping):
            task_id, ts = row["task_id"], row["ts"]
        else:
            task_id, ts = row[0], row[1]
        if task_id is not None and isinstance(ts, (int, float)):
            stamps[str(task_id)] = int(ts)
    return stamps


def _updated_at(task: Any, event_ts: int | None) -> int | None:
    stamps = [event_ts] if isinstance(event_ts, int) else []
    for name in ("created_at", "started_at", "completed_at"):
        value = _field(task, name)
        if isinstance(value, (int, float)):
            stamps.append(int(value))
    return max(stamps) if stamps else None


def _card(conn: Any, kb: dict[str, Any], task: Any, event_ts: int | None) -> dict[str, Any]:
    task_id = str(_field(task, "id") or "")
    priority = _field(task, "priority", 0)
    try:
        priority = int(priority)
    except (TypeError, ValueError):
        priority = 0
    return {
        "id": task_id,
        "title": str(_field(task, "title") or ""),
        "assignee": _field(task, "assignee"),
        "status": str(_field(task, "status") or ""),
        "priority": priority,
        "updated_at": _updated_at(task, event_ts),
        "parents": _ids(conn, kb, task_id, "parents"),
        "children": _ids(conn, kb, task_id, "children"),
    }


def _board_name(kb: dict[str, Any], requested: str | None) -> str:
    if requested:
        return requested
    current = kb.get("get_current_board")
    if current is not None:
        try:
            found = current()
            if found:
                return str(found)
        except Exception as exc:
            commands.warn_once("kanban-current", f"overlay-slash: get_current_board failed ({exc})")
    return "default"


def board_payload(board: str | None, include_archived: bool) -> dict[str, Any]:
    kb = _require_kb()
    conn = _open(kb, board)
    try:
        tasks = _call(
            kb["list_tasks"], conn, include_archived=include_archived,
        ) or []
        stamps = _event_stamps(conn)
        columns: dict[str, list[dict[str, Any]]] = {name: [] for name in BOARD_COLUMNS}
        extras: dict[str, list[dict[str, Any]]] = {}
        for task in tasks:
            status = str(_field(task, "status") or "")
            if status == "archived" and not include_archived:
                continue
            card = _card(conn, kb, task, stamps.get(str(_field(task, "id") or "")))
            if status in columns:
                columns[status].append(card)
            elif status == "archived" and include_archived:
                extras.setdefault("archived", []).append(card)
            elif status in EXTRA_COLUMNS:
                extras.setdefault(status, []).append(card)
            else:
                columns["todo"].append(card)
        ordered = [*BOARD_COLUMNS, *[name for name in (*EXTRA_COLUMNS, "archived") if name in extras]]
        return {
            "board": _board_name(kb, board),
            "columns": [
                {"name": name, "tasks": columns[name] if name in columns else extras.get(name, [])}
                for name in ordered
            ],
        }
    finally:
        _close(conn)


def _records(fn: Callable | None, conn: Any, task_id: str) -> list[Any]:
    if fn is None:
        return []
    try:
        return list(fn(conn, task_id) or [])
    except Exception as exc:
        commands.warn_once("kanban-records", f"overlay-slash: kanban list failed ({exc})")
        return []


def task_payload(board: str | None, task_id: str) -> dict[str, Any]:
    kb = _require_kb()
    conn = _open(kb, board)
    try:
        task = kb["get_task"](conn, task_id)
        if task is None:
            raise KanbanHTTP(404, "task not found")
        stamps = _event_stamps(conn)
        card = _card(conn, kb, task, stamps.get(task_id))
        card["body"] = _field(task, "body")
        comments = [_as_dict(row) for row in _records(kb.get("list_comments"), conn, task_id)]
        events = [_as_dict(row) for row in _records(kb.get("list_events"), conn, task_id)]
        if len(events) > RECENT_EVENTS:
            events = events[-RECENT_EVENTS:]
        return {"task": card, "comments": comments, "events": events}
    finally:
        _close(conn)


def _truthy(result: Any) -> bool:
    if isinstance(result, tuple):
        return bool(result[0])
    return bool(result)


def _direct_status(conn: Any, kb: dict[str, Any], task_id: str, status: str) -> bool:
    write = kb.get("write_txn")
    ctx = write(conn) if write is not None else nullcontext()

    def _update() -> bool:
        if status == "ready":
            for parent_id in _ids(conn, kb, task_id, "parents"):
                parent = kb["get_task"](conn, parent_id)
                parent_status = str(_field(parent, "status") or "")
                if parent is not None and parent_status not in {"done", "archived"}:
                    return False
        cur = conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
        return getattr(cur, "rowcount", 0) == 1

    with ctx:
        return _update()


def _apply_status(conn: Any, kb: dict[str, Any], task: Any, status: str) -> bool:
    task_id = str(_field(task, "id") or "")
    current = str(_field(task, "status") or "")
    if status == "done" and kb.get("complete_task") is not None:
        return _truthy(_call(kb["complete_task"], conn, task_id, force=True))
    if status == "blocked" and kb.get("block_task") is not None:
        return _truthy(_call(kb["block_task"], conn, task_id))
    if status == "scheduled" and kb.get("schedule_task") is not None:
        return _truthy(_call(kb["schedule_task"], conn, task_id))
    if status == "review" and kb.get("request_review") is not None:
        return _truthy(_call(kb["request_review"], conn, task_id, force=True))
    if status == "ready" and current in {"blocked", "scheduled"} and kb.get("unblock_task") is not None:
        return _truthy(kb["unblock_task"](conn, task_id))
    if current == "review" and status in {"triage", "todo", "ready"} and kb.get("reopen_review_task") is not None:
        return _truthy(kb["reopen_review_task"](conn, task_id))
    return _direct_status(conn, kb, task_id, status)


def _apply_patch(conn: Any, kb: dict[str, Any], board: str | None, task: Any, patch: Mapping[str, Any]) -> None:
    task_id = str(_field(task, "id") or "")
    if "assignee" in patch and kb.get("assign_task") is not None:
        assignee = patch.get("assignee") or None
        try:
            ok = kb["assign_task"](conn, task_id, assignee)
        except RuntimeError as exc:
            raise KanbanHTTP(409, str(exc)) from exc
        if not ok:
            raise KanbanHTTP(404, "task not found")
    if "status" in patch and patch.get("status") is not None:
        if not _apply_status(conn, kb, task, str(patch["status"])):
            raise KanbanHTTP(409, "status transition refused")
    edits: dict[str, Any] = {}
    if "priority" in patch and patch.get("priority") is not None:
        edits["priority"] = int(patch["priority"])
    if "title" in patch and patch.get("title") is not None:
        edits["title"] = str(patch["title"]).strip()
    if edits and kb.get("edit_task") is not None:
        if not _truthy(_call(kb["edit_task"], conn, task_id, board=board, **edits)):
            raise KanbanHTTP(409, "task update refused")
    elif edits:
        assignments = ", ".join(f"{key} = ?" for key in edits)
        conn.execute(
            f"UPDATE tasks SET {assignments} WHERE id = ?",
            (*edits.values(), task_id),
        )


def patch_payload(board: str | None, task_id: str, patch: Mapping[str, Any]) -> dict[str, Any]:
    _validate_patch(patch)
    kb = _require_kb()
    conn = _open(kb, board)
    try:
        task = kb["get_task"](conn, task_id)
        if task is None:
            raise KanbanHTTP(404, "task not found")
        _apply_patch(conn, kb, board, task, patch)
        updated = kb["get_task"](conn, task_id)
        if updated is None:
            raise KanbanHTTP(404, "task not found")
        stamps = _event_stamps(conn)
        return {"task": _card(conn, kb, updated, stamps.get(task_id))}
    finally:
        _close(conn)


def _validate_patch(patch: Mapping[str, Any]) -> None:
    if "status" in patch and patch["status"] is not None:
        status = patch["status"]
        if not isinstance(status, str):
            raise KanbanHTTP(400, "status must be a string")
        if status == "archived":
            raise KanbanHTTP(400, "archive is not supported")
        if status == "running":
            raise KanbanHTTP(400, "Cannot set status to 'running' directly")
        if status not in PATCH_STATUSES:
            raise KanbanHTTP(400, f"unknown status: {status}")
    if "priority" in patch and patch["priority"] is not None:
        priority = patch["priority"]
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise KanbanHTTP(400, "priority must be an integer")
    if "title" in patch and patch["title"] is not None:
        title = patch["title"]
        if not isinstance(title, str) or not title.strip():
            raise KanbanHTTP(400, "title cannot be empty")
    if "assignee" in patch and patch["assignee"] is not None and not isinstance(patch["assignee"], str):
        raise KanbanHTTP(400, "assignee must be a string")


def boards_payload(include_archived: bool) -> dict[str, Any]:
    kb = _require_kb()
    list_boards = kb.get("list_boards")
    if list_boards is None:
        raise KanbanHTTP(404, "kanban unavailable")
    try:
        boards = _call(list_boards, include_archived=include_archived) or []
    except TypeError:
        boards = list_boards() or []
    current = _board_name(kb, None)
    rows = []
    for board in boards:
        if isinstance(board, str):
            rows.append({"slug": board, "is_current": board == current})
            continue
        row = _as_dict(board)
        slug = str(row.get("slug") or row.get("name") or "")
        if not slug:
            continue
        row["slug"] = slug
        row["is_current"] = bool(row.get("is_current", slug == current))
        rows.append(row)
    return {"boards": rows, "current": current}
