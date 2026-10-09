"""overlay-slash — slash commands on the Hermes API server.

Register with ``ctx.register_platform_handler("api_server", wire)``. ``wire``
appends an aiohttp middleware (it does not reorder the router). Hermes runs
that middleware inside the profile scope, so the same handlers serve
``/v1/overlay/*`` and ``/p/<profile>/v1/overlay/*``.

Requires in-process plugins. ``plugins.isolation: host`` cannot register
platform handlers.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from typing import Any

from aiohttp import web

try:
    from . import commands
    from .commands import ExpandError, Settings
except ImportError:  # loaded as a top-level module (plugin dir on sys.path)
    import commands
    from commands import ExpandError, Settings

logger = logging.getLogger("overlay_slash")

# aiohttp 3.9+ warns on bare string keys in request storage.
OVERLAY_CMD = web.RequestKey("overlay_cmd")

_OVERLAY_GET = {"/v1/overlay/commands"}
_OVERLAY_POST = {"/v1/overlay/expand"}
_CHAT_EXACT = {"/v1/chat/completions", "/v1/responses"}


def _dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _json(data: Any, *, status: int = 200, headers: dict[str, str] | None = None) -> web.Response:
    return web.json_response(data, status=status, headers=headers, dumps=_dumps)


def _header_token(value: str) -> str:
    cleaned = "".join(ch for ch in str(value) if ch.isascii() and (ch.isalnum() or ch in "_.:+-"))
    return cleaned[:120]


async def _tag_header(request: web.Request, response: web.StreamResponse) -> None:
    try:
        name = request.get(OVERLAY_CMD) if hasattr(request, "get") else None
    except Exception:
        name = None
    token = _header_token(name) if name else ""
    if token and response is not None:
        response.headers["X-Hermes-Command"] = token


async def _check_auth(adapter: Any, request: web.Request) -> tuple[str, web.Response | None]:
    """Return (ok|deny|skip, response). ``skip`` means do not rewrite and do not answer."""
    fn = getattr(adapter, "_check_auth", None) if adapter is not None else None
    if not callable(fn):
        commands.warn_once(
            "auth",
            "overlay-slash: adapter._check_auth is missing; overlay endpoints refuse, chat is left unchanged",
        )
        return "skip", _json(
            {"error": {"message": "auth unavailable", "type": "gateway_auth_error",
                       "code": "gateway_auth_unavailable"}},
            status=401,
        )
    try:
        result = fn(request)
        if inspect.isawaitable(result):
            result = await result
    except Exception as exc:
        commands.warn_once("auth-call", f"overlay-slash: _check_auth raised ({exc}); leaving the request unchanged")
        return "skip", None
    if result is None:
        return "ok", None
    return "deny", result


def _cache_body(request: web.Request, data: bytes) -> bool:
    if not hasattr(request, "_read_bytes"):
        commands.warn_once(
            "read-bytes",
            "overlay-slash: request._read_bytes is missing; chat bodies will not be rewritten",
        )
        return False
    request._read_bytes = data
    cache = getattr(request, "_cache", None)
    if isinstance(cache, dict):
        cache.pop("json", None)
    return True


def _is_chat(path: str) -> bool:
    if path in _CHAT_EXACT:
        return True
    if not path.startswith("/api/sessions/"):
        return False
    rest = path[len("/api/sessions/"):]
    # "{id}/chat" or "{id}/chat/stream"
    parts = rest.split("/")
    return len(parts) >= 2 and parts[1] == "chat" and (len(parts) == 2 or (len(parts) == 3 and parts[2] == "stream"))


async def _read_json(request: web.Request) -> dict[str, Any] | None:
    try:
        raw = await request.read()
    except Exception as exc:
        commands.warn_once("read-body", f"overlay-slash: failed to read the request body ({exc})")
        return None
    if not raw:
        return {}
    try:
        import json
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    return body if isinstance(body, dict) else None


async def _sse_reply(request: web.Request, expansion: commands.Expansion) -> web.StreamResponse:
    token = _header_token(expansion.header_value())
    if token:
        request[OVERLAY_CMD] = token
    response = web.StreamResponse(status=200, headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
    if token:
        response.headers["X-Hermes-Command"] = token
    await response.prepare(request)
    session_id = commands.session_id_from_path(getattr(request, "path", "") or "")
    for event, data in commands.sse_events(expansion, session_id=session_id):
        frame = f"event: {event}\ndata: {commands.json_bytes(data).decode('utf-8')}\n\n"
        await response.write(frame.encode("utf-8"))
    await response.write_eof()
    return response


def _direct(request: web.Request, path: str, expansion: commands.Expansion, *, stream: bool) -> Any:
    token = _header_token(expansion.header_value())
    if token:
        request[OVERLAY_CMD] = token
    if stream:
        return _sse_reply(request, expansion)
    headers = {"X-Hermes-Command": token} if token else None
    return _json(commands.direct_reply_body(path, expansion), headers=headers)


async def _handle_commands(request: web.Request, settings: Settings) -> web.Response:
    profile = commands.request_profile(request)
    home = commands.current_home()
    payload = await asyncio.to_thread(commands.build_catalog, profile, home, settings)
    body = commands.json_bytes(payload)
    etag = f'"{commands.catalog_etag(payload)}"'
    if _etag_matches(request.headers.get("If-None-Match", ""), etag):
        return web.Response(status=304, headers={"ETag": etag, "Cache-Control": "private, must-revalidate"})
    return web.Response(
        status=200,
        body=body,
        content_type="application/json",
        charset="utf-8",
        headers={"ETag": etag, "Cache-Control": "private, must-revalidate"},
    )


def _etag_matches(header: str, etag: str) -> bool:
    if not header:
        return False
    wanted = etag.strip().removeprefix("W/").strip().strip('"')
    for part in header.split(","):
        token = part.strip()
        if token.startswith("W/"):
            token = token[2:].strip()
        token = token.strip('"')
        if token == "*" or token == wanted:
            return True
    return False


async def _handle_expand(request: web.Request, settings: Settings) -> web.Response:
    body = await _read_json(request)
    if body is None:
        return _json({"error": {"message": "Invalid JSON body", "type": "invalid_request_error",
                                 "code": "invalid_json"}}, status=400)
    text = body.get("text")
    if not isinstance(text, str):
        return _json({"error": {"message": "text must be a string", "type": "invalid_request_error",
                                 "code": "invalid_text"}}, status=422)
    profile = commands.request_profile(request)
    task_id = body.get("session_id") if isinstance(body.get("session_id"), str) else None
    try:
        expansion = await commands.expand_text(text, profile=profile, settings=settings, task_id=task_id)
    except ExpandError as err:
        return _json(commands.error_payload(err), status=err.status)
    except Exception as exc:
        commands.warn_once("expand", f"overlay-slash: expand failed ({exc})")
        return _json(commands.error_payload(ExpandError(
            422, "expand_failed", "command expansion failed",
        )), status=422)
    token = _header_token(expansion.header_value()) if expansion.kind != "none" else ""
    headers = {"X-Hermes-Command": token} if token else None
    return _json(expansion.to_json(), headers=headers)


async def _handle_skills(request: web.Request) -> web.Response:
    home = commands.current_home()
    try:
        payload = await asyncio.to_thread(commands.skills_list_payload, home)
    except Exception as exc:
        commands.warn_once("skills-fix", f"overlay-slash: GET /v1/skills workaround failed ({exc})")
        raise
    return _json(payload)


async def _rewrite_chat(request: web.Request, handler, settings: Settings, path: str):
    if not settings.rewrite_chat:
        return await handler(request)
    body = await _read_json(request)
    if body is None:
        return await handler(request)
    text = commands.extract_command_text(path, body)
    if text is None:
        return await handler(request)
    task_id = commands.session_id_from_path(request.path or "")
    try:
        expansion = await commands.expand_text(
            text, profile=commands.request_profile(request), settings=settings, task_id=task_id,
        )
    except ExpandError as err:
        if err.status == 404:
            return await handler(request)
        reply = commands.Expansion(
            "reply", command=err.command or "command", text=err.message,
            display=text.strip(), format="plain",
        )
        stream = commands.wants_stream(path, body)
        result = _direct(request, path, reply, stream=stream)
        return await result if inspect.isawaitable(result) else result
    except Exception as exc:
        commands.warn_once(
            "rewrite",
            f"overlay-slash: expansion failed ({exc}); passing the request through",
        )
        return await handler(request)

    if expansion.kind == "none":
        return await handler(request)
    if expansion.kind in {"prompt", "skill", "bundle"}:
        if commands.rewrite_body(path, body, expansion):
            encoded = commands.json_bytes(body)
            if not _cache_body(request, encoded):
                return await handler(request)
            token = _header_token(expansion.header_value())
            if token:
                request[OVERLAY_CMD] = token
        else:
            commands.warn_once("rewrite-apply", "overlay-slash: could not apply the expanded body; passing through")
        return await handler(request)
    if expansion.kind in {"reply", "plugin", "client"}:
        stream = commands.wants_stream(path, body)
        result = _direct(request, path, expansion, stream=stream)
        return await result if inspect.isawaitable(result) else result
    return await handler(request)


def make_middleware(adapter: Any, settings: Settings):
    @web.middleware
    async def overlay_mw(request: web.Request, handler):
        # Classification and auth only. Handler exceptions must propagate so a
        # failing chat turn is not dispatched a second time.
        try:
            path = commands.strip_profile(getattr(request, "path", "") or "")
            method = getattr(request, "method", "GET").upper()
            handled = (
                (method == "GET" and path in _OVERLAY_GET)
                or (method == "POST" and path in _OVERLAY_POST)
                or (method == "GET" and path == "/v1/skills" and settings.fix_v1_skills)
                or (method == "POST" and settings.rewrite_chat and _is_chat(path))
            )
            state, auth_response = await _check_auth(adapter, request) if handled else ("ok", None)
        except Exception as exc:
            commands.warn_once(
                "middleware",
                f"overlay-slash: middleware failed ({exc}); passing the request through",
            )
            return await handler(request)

        if not handled:
            return await handler(request)
        if state != "ok":
            if path in _OVERLAY_GET or path in _OVERLAY_POST:
                if auth_response is not None:
                    return auth_response
                return _json(
                    {"error": {"message": "Unauthorized", "type": "gateway_auth_error",
                               "code": "gateway_auth_failed"}},
                    status=401,
                )
            return await handler(request)
        try:
            if method == "GET" and path in _OVERLAY_GET:
                return await _handle_commands(request, settings)
            if method == "POST" and path in _OVERLAY_POST:
                return await _handle_expand(request, settings)
            if method == "GET" and path == "/v1/skills":
                try:
                    return await _handle_skills(request)
                except Exception as exc:
                    commands.warn_once("skills-fix", f"overlay-slash: GET /v1/skills workaround failed ({exc})")
                    return await handler(request)
            return await _rewrite_chat(request, handler, settings, path)
        except Exception as exc:
            if path in _OVERLAY_GET or path in _OVERLAY_POST:
                commands.warn_once("endpoint", f"overlay-slash: endpoint failed ({exc})")
                return _json(
                    {"error": {"message": "overlay-slash failed", "type": "server_error",
                               "code": "overlay_slash_failed"}},
                    status=500,
                )
            raise

    return overlay_mw


def attach(app: Any, adapter: Any, settings: Settings | None = None) -> None:
    """Append middleware and the response-header hook. Failures are logged once."""
    settings = settings or Settings()
    try:
        app.middlewares.append(make_middleware(adapter, settings))
    except Exception as exc:
        if "Cannot modify frozen list" in str(exc):
            commands.warn_once(
                "wire-mw",
                "overlay-slash: Cannot modify frozen list. The gateway is already running; "
                "install/enable does nothing until the gateway is restarted.",
            )
        else:
            commands.warn_once("wire-mw", f"overlay-slash: could not append middleware ({exc})")
        return
    try:
        signal = getattr(app, "on_response_prepare", None)
        if signal is not None:
            signal.append(_tag_header)
    except Exception as exc:
        commands.warn_once("wire-header", f"overlay-slash: could not append response hook ({exc})")
    logger.info("overlay-slash: api_server middleware attached (in-process)")


def wire(native: Any, adapter: Any = None) -> None:
    """Platform-handler factory. Hermes calls this with (aiohttp app, adapter)."""
    settings = getattr(wire, "settings", None) or Settings()
    attach(native, adapter, settings)


def register(ctx: Any) -> Any:
    """Plugin entry point."""
    settings = Settings.from_ctx(ctx)
    wire.settings = settings

    def _wire(native: Any, adapter: Any = None) -> None:
        try:
            attach(native, adapter, settings)
        except Exception as exc:
            commands.warn_once("wire", f"overlay-slash: platform handler failed ({exc})")

    try:
        ctx.register_platform_handler("api_server", _wire)
    except Exception as exc:
        commands.warn_once(
            "register",
            f"overlay-slash: register_platform_handler failed ({exc}). "
            "This plugin must run in-process (plugins.isolation cannot be host).",
        )
    return _wire
