"""Fake aiohttp app mirroring Hermes' API server layout (v0.21.6).

The catch-all ``/p/{profile}/{tail:.*}`` is registered before the plugin, the
same order that shadows plugin routes. overlay-slash answers from middleware
instead of the route table.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from aiohttp import ClientSession, web

import overlay_slash
import overlay_slash.commands as commands
from overlay_slash.commands import Settings


class Adapter:
    def __init__(self, key: str = "secret") -> None:
        self.key = key
        self.calls = 0

    def _check_auth(self, request: web.Request):
        self.calls += 1
        header = request.headers.get("Authorization", "")
        if header == f"Bearer {self.key}":
            return None
        return web.json_response(
            {"error": {"message": "Invalid gateway API key", "type": "gateway_auth_error"}},
            status=401,
        )


def _app(settings: Settings | None = None, adapter: Adapter | None = None) -> tuple[web.Application, dict[str, Any]]:
    state: dict[str, Any] = {"calls": 0, "bodies": []}

    @web.middleware
    async def prefix_mw(request, handler):
        return await handler(request)

    async def native_chat(request: web.Request):
        state["calls"] += 1
        body = await request.json()
        state["bodies"].append(body)
        text = body.get("message") or body.get("input")
        if text is None and isinstance(body.get("messages"), list):
            for msg in reversed(body["messages"]):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    text = msg.get("content")
                    break
        if text is None and "input" in body:
            text = body.get("input")
        stream = request.path.rstrip("/").endswith("/chat/stream") or body.get("stream") is True
        if stream:
            response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
            await response.prepare(request)
            await response.write(f"data: {json.dumps({'seen_input': text})}\n\n".encode())
            await response.write_eof()
            return response
        return web.json_response({"seen_input": text})

    async def ingress(request: web.Request):
        return web.json_response({"ingress": request.match_info.get("tail")}, status=404)

    async def native_skills(_request: web.Request):
        return web.json_response({"native": True}, status=500)

    app = web.Application(middlewares=[prefix_mw])
    for path in (
        "/api/sessions/{sid}/chat",
        "/api/sessions/{sid}/chat/stream",
        "/v1/chat/completions",
        "/v1/responses",
    ):
        app.router.add_route("POST", path, native_chat)
        app.router.add_route("POST", "/p/{profile}" + path, native_chat)
    app.router.add_route("GET", "/v1/skills", native_skills)
    app.router.add_route("GET", "/p/{profile}/v1/skills", native_skills)
    app.router.add_route("*", "/p/{profile}/{tail:.*}", ingress)
    overlay_slash.attach(app, adapter or Adapter(), settings or Settings())
    return app, state


class Server:
    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.base = ""
        self.session: ClientSession | None = None
        self.runner: web.AppRunner | None = None

    async def __aenter__(self) -> "Server":
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        self.session = ClientSession()
        return self

    async def __aexit__(self, *_exc) -> None:
        if self.session is not None:
            await self.session.close()
        if self.runner is not None:
            await self.runner.cleanup()

    def headers(self, auth: bool = True) -> dict[str, str]:
        return {"Authorization": "Bearer secret"} if auth else {}


def _run(coro):
    return asyncio.run(coro)


def _by_name(payload: dict) -> dict[str, dict]:
    return {row["name"]: row for row in payload["data"]}


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    for block in raw.split("\n\n"):
        if not block.strip():
            continue
        name, data = "", {}
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        events.append((name, data))
    return events


async def _catalog(server: Server, path: str = "/v1/overlay/commands", auth: bool = True):
    assert server.session is not None
    async with server.session.get(server.base + path, headers=server.headers(auth)) as resp:
        text = await resp.text()
        return resp.status, resp.headers, json.loads(text) if text else {}


def test_register_wires_api_server_handler():
    seen = {}

    class Ctx:
        def get_config(self, key, default=None):
            return default

        def register_platform_handler(self, platform, factory):
            seen["platform"] = platform
            seen["factory"] = factory

    factory = overlay_slash.register(Ctx())
    assert seen["platform"] == "api_server"
    assert callable(factory)
    assert callable(seen["factory"])


def test_catalog_shape_and_whitelist():
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            status, headers, body = await _catalog(server)
            assert status == 200
            assert body["object"] == "list"
            assert body["profile"] == "default"
            assert body["version"] == 1
            assert "warning" in body
            assert headers["ETag"]
            rows = _by_name(body)
            for row in body["data"]:
                for key in ("name", "kind", "category", "description", "args_hint", "aliases", "enabled"):
                    assert key in row
                assert row["name"].startswith("/")
                assert isinstance(row["enabled"], bool)
            plan = rows["/plan"]
            assert plan["kind"] == "prompt"
            assert plan["args_hint"] == "[task]"
            assert "plan" in plan["description"].lower() or "markdown" in plan["description"].lower()
            assert rows["/help"]["kind"] == "reply"
            assert rows["/version"]["kind"] == "reply"
            assert rows["/version"]["aliases"] == ["/v"]
            assert rows["/profile"]["kind"] == "reply"
            assert rows["/new"]["kind"] == "client"
            assert rows["/new"]["maps_to"] == "POST /api/sessions"
            assert rows["/title"]["maps_to"] == "PATCH /api/sessions/{id}"
            assert rows["/branch"]["maps_to"] == "POST /api/sessions/{id}/fork"
            assert rows["/model"]["maps_to"] == "POST /api/sessions/{id}/model"
            assert rows["/stop"]["kind"] == "client"
            assert rows["/stop"]["description"] == "Stop the current reply"
            assert rows["/stop"]["maps_to"] == "overlay stop"
            assert body["capabilities"] == {"kanban": False}
            assert "/init" not in rows
            for excluded in ("/clear", "/approve", "/compress", "/yolo", "/undo", "/retry", "/quit", "/platform"):
                assert excluded not in rows
            async with server.session.get(
                server.base + "/v1/overlay/commands",
                headers={**server.headers(), "If-None-Match": headers["ETag"]},
            ) as again:
                assert again.status == 304

    _run(inner())


def test_per_profile_routing_and_ingress_still_wins_for_other_paths():
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            status, _headers, body = await _catalog(server, "/p/researcher/v1/overlay/commands")
            assert status == 200
            assert body["profile"] == "researcher"
            assert server.session is not None
            async with server.session.get(
                server.base + "/p/researcher/v1/not-overlay", headers=server.headers(),
            ) as resp:
                assert resp.status == 404
                payload = await resp.json()
                assert payload["ingress"] == "v1/not-overlay"

    _run(inner())


def test_auth_required_on_plugin_endpoints_and_chat_is_not_rewritten():
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            status, _headers, body = await _catalog(server, auth=False)
            assert status == 401
            assert "error" in body
            assert server.session is not None
            async with server.session.post(
                server.base + "/api/sessions/s/chat/stream",
                json={"input": "/plan add dark mode"},
            ) as resp:
                assert resp.status == 200
                assert resp.headers.get("X-Hermes-Command") is None
                seen = json.loads((await resp.text()).split("data: ", 1)[1])
                assert seen["seen_input"] == "/plan add dark mode"
            assert state["calls"] == 1

    _run(inner())


def test_plan_rewrite_and_header():
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/p/researcher/api/sessions/s/chat/stream",
                headers=server.headers(),
                json={"input": "/plan add dark mode"},
            ) as resp:
                assert resp.status == 200
                assert resp.headers.get("X-Hermes-Command") == "plan"
                seen = json.loads((await resp.text()).split("data: ", 1)[1])
            plan_marker = '<!-- overlay-slash: {"display":"/plan add dark mode","command":"plan"} -->'
            assert seen["seen_input"].startswith(plan_marker + "\n")
            assert seen["seen_input"].split("\n", 1)[1].startswith("[/plan — plan mode]")
            assert "add dark mode" in seen["seen_input"]
            assert state["calls"] == 1
            async with server.session.post(
                server.base + "/v1/chat/completions",
                headers=server.headers(),
                json={"messages": [{"role": "user", "content": "/plan add dark mode"}]},
            ) as resp:
                payload = await resp.json()
            assert payload["seen_input"].startswith(plan_marker + "\n[/plan — plan mode]")
            async with server.session.post(
                server.base + "/v1/responses",
                headers=server.headers(),
                json={"input": "/learn a skill"},
            ) as resp:
                payload = await resp.json()
                assert resp.headers.get("X-Hermes-Command") == "learn"
            learn_marker = '<!-- overlay-slash: {"display":"/learn a skill","command":"learn"} -->'
            assert payload["seen_input"].startswith(learn_marker + "\n[/learn]")

    _run(inner())


def test_passthrough_unknown_and_escaped():
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            for text in ("//plan add dark mode", "/compress now", "hello", "/nope"):
                async with server.session.post(
                    server.base + "/api/sessions/s/chat",
                    headers=server.headers(),
                    json={"message": text},
                ) as resp:
                    payload = await resp.json()
                    assert resp.headers.get("X-Hermes-Command") is None
                assert payload["seen_input"] == text
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "hello"},
            ) as resp:
                assert resp.status == 200
                assert await resp.json() == {"kind": "none"}
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/nope"},
            ) as resp:
                assert resp.status == 404
                err = await resp.json()
                assert err["error"]["code"] == "unknown_command"

    _run(inner())
    assert state["calls"] == 4


def test_reply_kind_sse_does_not_call_the_agent():
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/api/sessions/s/chat/stream",
                headers=server.headers(),
                json={"input": "/version"},
            ) as resp:
                assert resp.status == 200
                assert resp.headers.get("X-Hermes-Command") == "version"
                raw = await resp.text()
            events = _parse_sse(raw)
            names = [name for name, _data in events]
            assert names == [
                "run.started", "message.started", "assistant.delta",
                "assistant.completed", "run.completed", "done",
            ]
            message_id = events[1][1]["message"]["id"]
            assert message_id.startswith("msg_")
            run_id = events[0][1]["run_id"]
            assert run_id.startswith("run_")
            for index, (_name, data) in enumerate(events, start=1):
                assert data["session_id"] == "s"
                assert data["run_id"] == run_id
                assert data["seq"] == index
                assert isinstance(data["ts"], (int, float))
            assert events[2][1]["message_id"] == message_id
            assert events[2][1]["delta"]
            for terminal in (events[3][1], events[4][1]):
                assert terminal["message_id"] == message_id
                assert terminal["completed"] is True
                assert terminal["partial"] is False
                assert terminal["interrupted"] is False
            assert "version" in raw.lower() or "Hermes" in raw
            async with server.session.post(
                server.base + "/api/sessions/s/chat",
                headers=server.headers(),
                json={"message": "/help"},
            ) as resp:
                assert resp.headers.get("Content-Type", "").startswith("application/json")
                body = await resp.json()
            assert body["object"] == "hermes.session.chat.completion"
            assert body["message"]["role"] == "assistant"
            assert body["message"]["content"]
        assert state["calls"] == 0

    _run(inner())


def test_failure_fallback_passes_original_body(caplog, monkeypatch):
    commands.reset_warnings()

    def boom(_task: str) -> str:
        raise RuntimeError("plan builder exploded")

    monkeypatch.setattr(commands, "plan_prompt", boom)
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/api/sessions/s/chat/stream",
                headers=server.headers(),
                json={"input": "/plan add dark mode"},
            ) as resp:
                assert resp.status == 200
                assert resp.headers.get("X-Hermes-Command") is None
                seen = json.loads((await resp.text()).split("data: ", 1)[1])
            assert seen["seen_input"] == "/plan add dark mode"
        assert state["calls"] == 1

    _run(inner())
    assert "passing the request through" in caplog.text


def test_skill_rewrite_disabled_and_load_failure(monkeypatch):
    table: dict[tuple[str, str], Any] = {}

    def load_symbol(module: str, name: str):
        return table.get((module, name))

    monkeypatch.setattr(commands, "load_symbol", load_symbol)

    def resolve(command: str, interactive: bool = False):
        if command.lower() == "arxiv":
            return "/arxiv"
        if command.lower() == "pdf":
            return "/pdf"
        return None

    def split(rest: str, interactive: bool = False):
        return [], rest

    def build(key: str, instruction: str = "", task_id: str | None = None):
        if key == "/missing":
            return None
        return f"SKILL {key} :: {instruction}"

    def interactive():
        return {
            "/arxiv": {"name": "arxiv", "description": "Fetch papers", "category": "research"},
            "/pdf": {"name": "pdf", "description": "Read PDFs"},
        }

    def find(*, skip_disabled: bool = False):
        return [
            {"name": "arxiv", "description": "Fetch papers", "category": "research"},
            {"name": "hidden", "description": "off", "category": "research"},
        ]

    def sort(skills):
        return skills

    def disabled(platform: str | None = None):
        assert platform == "api_server"
        return {"hidden"}

    def slugify(name: str) -> str:
        return name.lower()

    table.update({
        ("agent.skill_commands", "resolve_skill_command_key"): resolve,
        ("agent.skill_commands", "split_stacked_skill_commands"): split,
        ("agent.skill_commands", "build_skill_invocation_message"): build,
        ("agent.skill_commands", "get_interactive_skill_commands"): interactive,
        ("agent.skill_commands", "slugify_skill_name"): slugify,
        ("agent.skill_utils", "get_disabled_skill_names"): disabled,
        ("tools.skills_tool", "_find_all_skills"): find,
        ("tools.skills_tool", "_sort_skills"): sort,
    })

    app, state = _app()

    async def inner():
        async with Server(app) as server:
            _status, _headers, body = await _catalog(server, "/p/lab/v1/overlay/commands")
            rows = _by_name(body)
            assert rows["/arxiv"]["kind"] == "skill"
            assert rows["/arxiv"]["category"] == "research"
            assert rows["/arxiv"]["enabled"] is True
            assert rows["/hidden"]["enabled"] is False
            assert body["profile"] == "lab"
            assert server.session is not None
            async with server.session.post(
                server.base + "/api/sessions/sid/chat/stream",
                headers=server.headers(),
                json={"input": "/arxiv quantum"},
            ) as resp:
                assert resp.headers.get("X-Hermes-Command") == "skill:arxiv"
                seen = json.loads((await resp.text()).split("data: ", 1)[1])
            marker = '<!-- overlay-slash: {"display":"/arxiv quantum","command":"arxiv"} -->'
            assert seen["seen_input"] == marker + "\nSKILL /arxiv :: quantum"
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/hidden please"},
            ) as resp:
                assert resp.status == 409
                assert (await resp.json())["error"]["code"] == "skill_disabled"
            table[("agent.skill_commands", "resolve_skill_command_key")] = lambda command, interactive=False: "/missing" if command == "missing" else resolve(command, interactive)
            table[("agent.skill_commands", "build_skill_invocation_message")] = lambda key, instruction="", task_id=None: None
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/missing now"},
            ) as resp:
                assert resp.status == 422
                assert (await resp.json())["error"]["code"] == "skill_load_failed"
        assert state["calls"] == 1

    _run(inner())


def test_expand_plan_queue_and_client():
    app, _state = _app(Settings(allow_init=True))

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/plan add dark mode"},
            ) as resp:
                body = await resp.json()
            assert body["kind"] == "prompt"
            assert body["command"] == "plan"
            assert body["display"] == "/plan add dark mode"
            assert body["notice"] == "Planning: add dark mode"
            assert body["message"].startswith("[/plan — plan mode]")
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/q ship it"},
            ) as resp:
                body = await resp.json()
            assert body["kind"] == "prompt"
            assert body["command"] == "queue"
            assert body["message"] == "ship it"
            async with server.session.post(
                server.base + "/p/researcher/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/new"},
            ) as resp:
                body = await resp.json()
            assert body["kind"] == "client"
            assert body["maps_to"] == "POST /api/sessions"
            _status, _headers, catalog = await _catalog(server)
            assert "/init" in _by_name(catalog)

    _run(inner())


def test_fix_v1_skills_is_opt_in_and_auth_gated(monkeypatch):
    captured: dict[str, Any] = {}

    def find(*, skip_disabled: bool = False, include_editorial: bool = False):
        captured["kwargs"] = {"skip_disabled": skip_disabled, "include_editorial": include_editorial}
        return [{"name": "arxiv", "description": "papers", "category": "research"}]

    def sort(skills):
        return list(skills)

    def load_symbol(module: str, name: str):
        if (module, name) == ("tools.skills_tool", "_find_all_skills"):
            return find
        if (module, name) == ("tools.skills_tool", "_sort_skills"):
            return sort
        return None

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    off, _state = _app(Settings(fix_v1_skills=False))
    on, _state2 = _app(Settings(fix_v1_skills=True))

    async def inner():
        async with Server(off) as server:
            assert server.session is not None
            async with server.session.get(server.base + "/v1/skills", headers=server.headers()) as resp:
                assert resp.status == 500
                assert await resp.json() == {"native": True}
        async with Server(on) as server:
            assert server.session is not None
            async with server.session.get(server.base + "/p/researcher/v1/skills") as resp:
                assert resp.status == 500
                assert (await resp.json())["native"] is True
            async with server.session.get(server.base + "/v1/skills", headers=server.headers()) as resp:
                assert resp.status == 200
                body = await resp.json()
            assert body == {"object": "list", "data": [
                {"name": "arxiv", "description": "papers", "category": "research"},
            ]}
            assert captured["kwargs"]["include_editorial"] is True
            assert captured["kwargs"]["skip_disabled"] is False

    _run(inner())


def test_include_editorial_only_when_accepted(monkeypatch):
    strict_calls: list[dict] = []

    def strict(*, skip_disabled: bool = False):
        strict_calls.append({"skip_disabled": skip_disabled})
        return [{"name": "arxiv", "description": "d", "category": "c"}]

    def load_symbol(module: str, name: str):
        if (module, name) == ("tools.skills_tool", "_find_all_skills"):
            return strict
        return None

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    found = commands._find_skills()
    assert found[0]["name"] == "arxiv"
    assert strict_calls == [{"skip_disabled": False}]


def test_profile_home_is_applied_in_the_worker(monkeypatch):
    seen: dict[str, Any] = {}

    def get_home():
        return "/hermes/profiles/researcher"

    def set_ov(home: str):
        seen["set"] = home
        return "token"

    def reset_ov(token: str):
        seen["reset"] = token

    def find(*, skip_disabled: bool = False):
        seen["during"] = seen.get("set")
        return [{"name": "arxiv", "description": "d", "category": "research"}]

    def load_symbol(module: str, name: str):
        return {
            ("hermes_constants", "get_hermes_home"): get_home,
            ("hermes_constants", "set_hermes_home_override"): set_ov,
            ("hermes_constants", "reset_hermes_home_override"): reset_ov,
            ("tools.skills_tool", "_find_all_skills"): find,
        }.get((module, name))

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            _status, _headers, body = await _catalog(server, "/p/researcher/v1/overlay/commands")
            assert body["profile"] == "researcher"
            assert "/arxiv" in _by_name(body)

    _run(inner())
    assert seen["set"] == "/hermes/profiles/researcher"
    assert seen["during"] == "/hermes/profiles/researcher"
    assert seen["reset"] == "token"


def test_missing_body_cache_falls_through(monkeypatch):
    monkeypatch.setattr(overlay_slash, "_cache_body", lambda _request, _data: False)
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/api/sessions/s/chat",
                headers=server.headers(),
                json={"input": "/plan add dark mode"},
            ) as resp:
                payload = await resp.json()
            assert payload["seen_input"] == "/plan add dark mode"
        assert state["calls"] == 1

    _run(inner())


def test_plugin_command_catalog_and_direct_reply(monkeypatch):
    def commands_map():
        return {"ship": {"description": "Ship the branch", "args_hint": "[name]", "handler": object()}}

    def handler(name: str):
        if name == "ship":
            return lambda args: f"shipped {args}".strip()
        return None

    def load_symbol(module: str, name: str):
        if (module, name) == ("hermes_cli.plugins", "get_plugin_commands"):
            return commands_map
        if (module, name) == ("hermes_cli.plugins", "get_plugin_command_handler"):
            return handler
        return None

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    app, state = _app()

    async def inner():
        async with Server(app) as server:
            _status, _headers, body = await _catalog(server)
            row = _by_name(body)["/ship"]
            assert row["kind"] == "plugin"
            assert row["description"] == "Ship the branch"
            assert row["args_hint"] == "[name]"
            assert "handler" not in row
            assert server.session is not None
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/ship now"},
            ) as resp:
                payload = await resp.json()
            assert payload["kind"] == "plugin"
            assert payload["text"] == "shipped now"
            async with server.session.post(
                server.base + "/v1/chat/completions",
                headers=server.headers(),
                json={"stream": False, "messages": [{"role": "user", "content": "/ship now"}]},
            ) as resp:
                chat = await resp.json()
                assert resp.headers.get("X-Hermes-Command") == "ship"
            assert chat["choices"][0]["message"]["content"] == "shipped now"
        assert state["calls"] == 0

    _run(inner())


def test_history_marker_is_one_line_and_expand_omits_it():
    marker = commands.history_marker("/plan add dark mode", "plan")
    assert marker == '<!-- overlay-slash: {"display":"/plan add dark mode","command":"plan"} -->'
    assert "\n" not in marker
    messy = commands.history_marker("/plan line\nbreak --> stay", "plan")
    assert "\n" not in messy
    assert "-->" not in messy[len("<!-- overlay-slash: "):-3]
    assert messy.endswith("-->")
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/plan add dark mode"},
            ) as resp:
                body = await resp.json()
            assert body["message"].startswith("[/plan — plan mode]")
            assert "overlay-slash:" not in body["message"]

    _run(inner())


def test_stale_skill_map_reloads_once_and_catalog_matches(monkeypatch):
    state = {"reloads": 0, "ready": False}

    def resolve(command: str, interactive: bool = False):
        if state["ready"] and command == "fresh":
            return "/fresh"
        return None

    def reload_skills():
        state["reloads"] += 1
        state["ready"] = True
        return {"added": [{"name": "fresh"}]}

    def interactive():
        if not state["ready"]:
            return {}
        return {"/fresh": {"name": "fresh", "description": "just installed", "category": "research"}}

    def find(*, skip_disabled: bool = False):
        return [
            {"name": "fresh", "description": "just installed", "category": "research"},
            {"name": "ghost", "description": "scanner will not register this", "category": "other"},
        ]

    def build(key: str, instruction: str = "", task_id: str | None = None):
        return f"SKILL {key} :: {instruction}"

    def load_symbol(module: str, name: str):
        table = {
            ("agent.skill_commands", "resolve_skill_command_key"): resolve,
            ("agent.skill_commands", "reload_skills"): reload_skills,
            ("agent.skill_commands", "get_interactive_skill_commands"): interactive,
            ("agent.skill_commands", "build_skill_invocation_message"): build,
            ("agent.skill_commands", "split_stacked_skill_commands"): lambda rest, interactive=False: ([], rest),
            ("tools.skills_tool", "_find_all_skills"): find,
            ("tools.skills_tool", "_sort_skills"): lambda skills: skills,
            ("agent.skill_commands", "slugify_skill_name"): lambda name: name.lower(),
        }
        return table.get((module, name))

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    app, chat = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/fresh please"},
            ) as resp:
                assert resp.status == 200
                body = await resp.json()
            assert body["kind"] == "skill"
            assert body["command"] == "fresh"
            assert body["message"] == "SKILL /fresh :: please"
            assert "overlay-slash:" not in body["message"]
            assert state["reloads"] == 1
            async with server.session.post(
                server.base + "/api/sessions/s/chat",
                headers=server.headers(),
                json={"input": "/fresh please"},
            ) as resp:
                seen = await resp.json()
            assert seen["seen_input"].startswith(
                '<!-- overlay-slash: {"display":"/fresh please","command":"fresh"} -->\nSKILL /fresh :: please'
            )
            # Map is warm: a second expand must not rescan.
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/fresh again"},
            ) as resp:
                assert resp.status == 200
            assert state["reloads"] == 1
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/ghost"},
            ) as resp:
                assert resp.status == 404
            # One retry for the miss, still not registered.
            assert state["reloads"] == 2
            _status, _headers, catalog = await _catalog(server)
            rows = _by_name(catalog)
            assert rows["/fresh"]["kind"] == "skill"
            assert rows["/fresh"]["enabled"] is True
            assert "/ghost" not in rows

    _run(inner())
    assert chat["calls"] == 1


def test_stop_keeps_overlay_description_when_hermes_describes_it(monkeypatch):
    class Live:
        description = "Kill all running background processes"
        args_hint = ""
        aliases = ()
        category = "Session"

        def describe(self):
            return "Kill all running background processes"

    def load_symbol(module: str, name: str):
        if (module, name) == ("hermes_cli.commands", "resolve_command"):
            return lambda command: Live() if command == "stop" else None
        return None

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            _status, _headers, body = await _catalog(server)
            row = _by_name(body)["/stop"]
            assert row["kind"] == "client"
            assert row["description"] == "Stop the current reply"
            assert row["maps_to"] == "overlay stop"

    _run(inner())


def test_deleted_skill_is_omitted_and_expand_is_unknown(monkeypatch, tmp_path):
    kept = tmp_path / "kept" / "SKILL.md"
    kept.parent.mkdir()
    kept.write_text("name: kept\n", encoding="utf-8")
    gone = tmp_path / "gone" / "SKILL.md"
    orphan = tmp_path / "orphan"
    orphan.mkdir()
    state = {"reloads": 0, "gone": True, "stuck": False}

    def resolve(command: str, interactive: bool = False):
        if command == "kept":
            return "/kept"
        if command == "gone" and state["gone"]:
            return "/gone"
        if command == "stuck":
            return "/stuck"
        return None

    def reload_skills():
        state["reloads"] += 1
        state["gone"] = False
        return {"removed": [{"name": "gone"}]}

    def interactive():
        rows = {
            "/kept": {
                "name": "kept", "description": "still here",
                "skill_md_path": str(kept), "skill_dir": str(kept.parent),
            },
            "/orphan": {"name": "orphan", "description": "dir only", "skill_dir": str(orphan)},
            "/legacy": {"name": "legacy", "description": "no recorded path"},
        }
        if state["gone"]:
            rows["/gone"] = {
                "name": "gone", "description": "deleted on disk",
                "skill_md_path": str(gone), "skill_dir": str(gone.parent),
            }
        if state["stuck"]:
            rows["/stuck"] = {
                "name": "stuck", "description": "still cached",
                "skill_md_path": str(gone),
            }
        return rows

    def build(key: str, instruction: str = "", task_id: str | None = None):
        if key in {"/gone", "/stuck"}:
            return None
        return f"SKILL {key} :: {instruction}"

    def load_symbol(module: str, name: str):
        table = {
            ("agent.skill_commands", "resolve_skill_command_key"): resolve,
            ("agent.skill_commands", "reload_skills"): reload_skills,
            ("agent.skill_commands", "get_interactive_skill_commands"): interactive,
            ("agent.skill_commands", "build_skill_invocation_message"): build,
            ("agent.skill_commands", "split_stacked_skill_commands"): lambda rest, interactive=False: ([], rest),
            ("tools.skills_tool", "_find_all_skills"): lambda **_kwargs: [],
            ("tools.skills_tool", "_sort_skills"): lambda skills: skills,
            ("agent.skill_commands", "slugify_skill_name"): lambda name: name.lower(),
        }
        return table.get((module, name))

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    app, chat = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            _status, _headers, catalog = await _catalog(server)
            rows = _by_name(catalog)
            assert rows["/kept"]["kind"] == "skill"
            assert rows["/legacy"]["kind"] == "skill"
            assert "/gone" not in rows
            assert "/orphan" not in rows
            assert state["reloads"] == 0
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/gone please"},
            ) as resp:
                assert resp.status == 404
                err = await resp.json()
            assert err["error"]["code"] == "unknown_command"
            assert "failed to load" not in err["error"]["message"]
            assert state["reloads"] == 1
            async with server.session.post(
                server.base + "/api/sessions/s/chat",
                headers=server.headers(),
                json={"input": "/gone please"},
            ) as resp:
                seen = await resp.json()
            assert seen["seen_input"] == "/gone please"
            # The chat miss reloads once more (the command is already gone).
            assert state["reloads"] == 2
            # Reload ran, the file is still missing, and the builder still returns nothing.
            state["stuck"] = True
            async with server.session.post(
                server.base + "/v1/overlay/expand",
                headers=server.headers(),
                json={"text": "/stuck"},
            ) as resp:
                assert resp.status == 404
                err = await resp.json()
            assert err["error"]["code"] == "unknown_command"
            assert state["reloads"] == 3

    _run(inner())
    assert chat["calls"] == 1


def test_attach_after_freeze_logs_and_leaves_routes_working(caplog):
    commands.reset_warnings()
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            overlay_slash.attach(app, Adapter(), Settings())
            status, _headers, body = await _catalog(server)
            assert status == 200
            assert body["object"] == "list"

    _run(inner())
    assert "Cannot modify frozen list" in caplog.text


def test_kanban_proxy_unavailable_without_hermes():
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            async with server.session.get(server.base + "/v1/overlay/kanban/board", headers=server.headers()) as resp:
                assert resp.status == 404
                assert await resp.json() == {"error": "kanban unavailable"}
            async with server.session.get(server.base + "/v1/overlay/kanban/board") as resp:
                assert resp.status == 401

    _run(inner())


def test_kanban_proxy_reads_and_patches_temp_db(monkeypatch, tmp_path):
    import sqlite3

    root = tmp_path / "kanban"
    schema = """
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT,
            assignee TEXT,
            status TEXT NOT NULL,
            priority INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            started_at INTEGER,
            completed_at INTEGER,
            result TEXT
        );
        CREATE TABLE IF NOT EXISTS task_links (parent_id TEXT NOT NULL, child_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            author TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT,
            created_at INTEGER NOT NULL
        );
    """

    def _connect(slug: str) -> sqlite3.Connection:
        path = root / slug / "kanban.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        conn.executescript(schema)
        return conn

    def _seed() -> None:
        conn = _connect("default")
        conn.executemany(
            "INSERT INTO tasks (id, title, body, assignee, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                ("p1", "parent", "body-p", None, "todo", 1, 100),
                ("c1", "child", "body-c", "ada", "todo", 0, 110),
                ("run1", "running card", None, None, "running", 2, 120),
                ("arch1", "old", None, None, "archived", 0, 130),
                ("sched1", "later", None, None, "scheduled", 0, 140),
                ("ready1", "ship", None, None, "ready", 3, 150),
            ],
        )
        conn.execute("INSERT INTO task_links (parent_id, child_id) VALUES ('p1', 'c1')")
        conn.execute(
            "INSERT INTO task_comments (task_id, author, body, created_at) VALUES ('c1', 'ada', 'note', 500)"
        )
        conn.executemany(
            "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('c1', 'tick', NULL, ?)",
            [(1000 + i,) for i in range(1, 61)],
        )
        conn.commit()
        conn.close()
        other = _connect("ops")
        other.execute(
            "INSERT INTO tasks (id, title, body, assignee, status, priority, created_at) VALUES ('o1', 'ops card', NULL, NULL, 'todo', 0, 10)"
        )
        other.commit()
        other.close()

    _seed()

    class Task:
        def __init__(self, row: sqlite3.Row) -> None:
            self.id = row["id"]
            self.title = row["title"]
            self.body = row["body"]
            self.assignee = row["assignee"]
            self.status = row["status"]
            self.priority = row["priority"]
            self.created_at = row["created_at"]
            self.started_at = row["started_at"]
            self.completed_at = row["completed_at"]

    class Note:
        def __init__(self, row: sqlite3.Row) -> None:
            self.id = row["id"]
            self.task_id = row["task_id"]
            self.author = row["author"]
            self.body = row["body"]
            self.created_at = row["created_at"]

    class Event:
        def __init__(self, row: sqlite3.Row) -> None:
            self.id = row["id"]
            self.task_id = row["task_id"]
            self.kind = row["kind"]
            self.payload = None
            self.created_at = row["created_at"]
            self.run_id = None

    def connect(board: str | None = None) -> sqlite3.Connection:
        return _connect(board or "default")

    def init_db(board: str | None = None) -> None:
        conn = connect(board)
        conn.close()

    def get_current_board() -> str:
        return "default"

    def list_boards(*, include_archived: bool = False) -> list[dict]:
        return [{"slug": "default", "name": "Default"}, {"slug": "ops", "name": "Ops"}]

    def _tasks(conn: sqlite3.Connection, *, include_archived: bool) -> list[Task]:
        query = "SELECT * FROM tasks"
        if not include_archived:
            query += " WHERE status != 'archived'"
        query += " ORDER BY priority DESC, created_at ASC"
        return [Task(row) for row in conn.execute(query)]

    def list_tasks(conn: sqlite3.Connection, *, include_archived: bool = False, **_kwargs: Any) -> list[Task]:
        return _tasks(conn, include_archived=include_archived)

    def get_task(conn: sqlite3.Connection, task_id: str) -> Task | None:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return Task(row) if row else None

    def parent_ids(conn: sqlite3.Connection, task_id: str) -> list[str]:
        return [row["parent_id"] for row in conn.execute(
            "SELECT parent_id FROM task_links WHERE child_id = ? ORDER BY parent_id", (task_id,),
        )]

    def child_ids(conn: sqlite3.Connection, task_id: str) -> list[str]:
        return [row["child_id"] for row in conn.execute(
            "SELECT child_id FROM task_links WHERE parent_id = ? ORDER BY child_id", (task_id,),
        )]

    def list_comments(conn: sqlite3.Connection, task_id: str) -> list[Note]:
        return [Note(row) for row in conn.execute(
            "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC", (task_id,),
        )]

    def list_events(conn: sqlite3.Connection, task_id: str) -> list[Event]:
        return [Event(row) for row in conn.execute(
            "SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC", (task_id,),
        )]

    def assign_task(conn: sqlite3.Connection, task_id: str, profile: str | None) -> bool:
        cur = conn.execute("UPDATE tasks SET assignee = ? WHERE id = ?", (profile, task_id))
        conn.commit()
        return cur.rowcount == 1

    def edit_task(conn: sqlite3.Connection, task_id: str, *, title: str | None = None,
                  priority: int | None = None, board: str | None = None) -> bool:
        sets, vals = [], []
        if title is not None:
            sets.append("title = ?")
            vals.append(title)
        if priority is not None:
            sets.append("priority = ?")
            vals.append(priority)
        if not sets:
            return False
        cur = conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", (*vals, task_id))
        conn.execute(
            "INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, 'edited', NULL, 2000)",
            (task_id,),
        )
        conn.commit()
        return cur.rowcount == 1

    def complete_task(conn: sqlite3.Connection, task_id: str, *, result: str | None = None,
                      summary: str | None = None, force: bool = False) -> bool:
        if not str(result or "").strip() and not str(summary or "").strip():
            raise ValueError(f"completion blocked: {task_id} has no result or summary evidence")
        cur = conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = 1800, result = ? WHERE id = ?",
            (result or summary, task_id),
        )
        conn.commit()
        return cur.rowcount == 1

    def block_task(conn: sqlite3.Connection, task_id: str) -> bool:
        cur = conn.execute("UPDATE tasks SET status = 'blocked' WHERE id = ?", (task_id,))
        conn.commit()
        return cur.rowcount == 1

    def unblock_task(conn: sqlite3.Connection, task_id: str) -> bool:
        cur = conn.execute("UPDATE tasks SET status = 'ready' WHERE id = ?", (task_id,))
        conn.commit()
        return cur.rowcount == 1

    symbols = {
        "connect": connect,
        "init_db": init_db,
        "get_current_board": get_current_board,
        "list_boards": list_boards,
        "list_tasks": list_tasks,
        "get_task": get_task,
        "parent_ids": parent_ids,
        "child_ids": child_ids,
        "list_comments": list_comments,
        "list_events": list_events,
        "assign_task": assign_task,
        "edit_task": edit_task,
        "complete_task": complete_task,
        "block_task": block_task,
        "unblock_task": unblock_task,
    }

    def load_symbol(module: str, name: str):
        if module == "hermes_cli.kanban_db":
            return symbols.get(name)
        return None

    monkeypatch.setattr(commands, "load_symbol", load_symbol)
    app, _state = _app()

    async def inner():
        async with Server(app) as server:
            assert server.session is not None
            _status, _headers, catalog = await _catalog(server)
            assert catalog["capabilities"] == {"kanban": True}
            async with server.session.get(
                server.base + "/v1/overlay/kanban/board?include_archived=0",
                headers=server.headers(),
            ) as resp:
                assert resp.status == 200
                board = await resp.json()
            assert board["board"] == "default"
            names = [column["name"] for column in board["columns"]]
            assert names[:6] == ["triage", "todo", "ready", "running", "blocked", "done"]
            assert "scheduled" in names
            assert "archived" not in names
            by_col = {column["name"]: column["tasks"] for column in board["columns"]}
            assert [task["id"] for task in by_col["todo"]] == ["p1", "c1"]
            assert by_col["running"][0]["id"] == "run1"
            assert by_col["ready"][0]["id"] == "ready1"
            assert by_col["scheduled"][0]["id"] == "sched1"
            child = next(task for task in by_col["todo"] if task["id"] == "c1")
            parent = next(task for task in by_col["todo"] if task["id"] == "p1")
            assert child["parents"] == ["p1"]
            assert parent["children"] == ["c1"]
            assert child["updated_at"] == 1060
            assert child["assignee"] == "ada"
            async with server.session.get(
                server.base + "/v1/overlay/kanban/board?include_archived=1",
                headers=server.headers(),
            ) as resp:
                archived = await resp.json()
            archived_ids = [
                task["id"]
                for column in archived["columns"] if column["name"] == "archived"
                for task in column["tasks"]
            ]
            assert archived_ids == ["arch1"]
            async with server.session.get(
                server.base + "/p/lab/v1/overlay/kanban/tasks/c1",
                headers=server.headers(),
            ) as resp:
                assert resp.status == 200
                detail = await resp.json()
            assert detail["task"]["body"] == "body-c"
            assert detail["comments"][0]["body"] == "note"
            assert len(detail["events"]) == 50
            assert detail["events"][0]["created_at"] == 1011
            assert detail["events"][-1]["created_at"] == 1060
            async with server.session.patch(
                server.base + "/v1/overlay/kanban/tasks/ready1",
                headers=server.headers(),
                json={"status": "done", "assignee": "ada", "priority": 7, "title": "shipped"},
            ) as resp:
                assert resp.status == 200
                patched = await resp.json()
            assert patched["task"]["status"] == "done"
            assert patched["task"]["assignee"] == "ada"
            assert patched["task"]["priority"] == 7
            assert patched["task"]["title"] == "shipped"
            assert patched["task"]["updated_at"] == 2000
            async with server.session.patch(
                server.base + "/v1/overlay/kanban/tasks/c1",
                headers=server.headers(),
                json={"status": "ready"},
            ) as resp:
                assert resp.status == 409
                assert (await resp.json())["error"] == "status transition refused"
            async with server.session.patch(
                server.base + "/v1/overlay/kanban/tasks/missing",
                headers=server.headers(),
                json={"title": "nope"},
            ) as resp:
                assert resp.status == 404
                assert (await resp.json())["error"] == "task not found"
            for bad in ("running", "archived", "nope"):
                async with server.session.patch(
                    server.base + "/v1/overlay/kanban/tasks/c1",
                    headers=server.headers(),
                    json={"status": bad},
                ) as resp:
                    assert resp.status == 400
            async with server.session.patch(
                server.base + "/v1/overlay/kanban/tasks/c1",
                headers=server.headers(),
                data=b"not-json",
            ) as resp:
                assert resp.status == 400
                assert (await resp.json())["error"] == "invalid json"
            async with server.session.get(
                server.base + "/v1/overlay/kanban/board?board=ops",
                headers=server.headers(),
            ) as resp:
                ops = await resp.json()
            assert ops["board"] == "ops"
            assert [task["id"] for column in ops["columns"] for task in column["tasks"]] == ["o1"]
            async with server.session.get(
                server.base + "/v1/overlay/kanban/boards",
                headers=server.headers(),
            ) as resp:
                boards = await resp.json()
            assert boards["current"] == "default"
            assert [row["slug"] for row in boards["boards"]] == ["default", "ops"]
            assert boards["boards"][0]["is_current"] is True

    _run(inner())
    saved = sqlite3.connect(root / "default" / "kanban.db")
    row = saved.execute("SELECT title, assignee, status, priority, result FROM tasks WHERE id = 'ready1'").fetchone()
    saved.close()
    assert tuple(row) == ("shipped", "ada", "done", 7, "Moved to done from overlay")


def test_kanban_connect_follows_v0216_module_split(tmp_path, caplog):
    """``connect`` is resolved through importlib, matching Hermes v0.21.6.

    ``hermes_cli.kanban_db`` does not define ``connect``. The function lives in
    ``hermes_cli.kanban_db_connect``. This does not stub ``load_symbol``.
    """
    import ast
    import sys
    from pathlib import Path

    import overlay_slash.kanban as kanban

    real = Path("/tmp/hermes-src/hermes_cli")
    db_file = real / "kanban_db.py"
    connect_file = real / "kanban_db_connect.py"
    if db_file.is_file() and connect_file.is_file():
        exported: set[str] = set()
        tree = ast.parse(db_file.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "connect":
                exported.add("connect")
            if isinstance(node, ast.ImportFrom) and node.module == "hermes_cli.kanban_db_connect":
                exported.update(alias.name for alias in node.names)
        assert "def connect(" in connect_file.read_text(encoding="utf-8")
        assert "connect" not in exported

    pkg = tmp_path / "layout"
    cli = pkg / "hermes_cli"
    cli.mkdir(parents=True)
    db_path = tmp_path / "kanban.db"
    (cli / "__init__.py").write_text("", encoding="utf-8")
    (cli / "kanban_db_connect.py").write_text(
        "import sqlite3\n"
        "from pathlib import Path\n"
        f"DB = Path({str(db_path)!r})\n"
        "def connect(board=None):\n"
        "    conn = sqlite3.connect(DB)\n"
        "    conn.row_factory = sqlite3.Row\n"
        "    return conn\n",
        encoding="utf-8",
    )
    (cli / "kanban_db.py").write_text(
        "class Task:\n"
        "    def __init__(self, row):\n"
        "        self.id = row['id']\n"
        "        self.title = row['title']\n"
        "        self.assignee = row['assignee']\n"
        "        self.status = row['status']\n"
        "        self.priority = row['priority']\n"
        "        self.created_at = row['created_at']\n"
        "        self.started_at = row['started_at']\n"
        "        self.completed_at = row['completed_at']\n"
        "        self.body = row['body']\n"
        "        self.result = row['result']\n"
        "def list_tasks(conn, *, include_archived=False):\n"
        "    return [Task(row) for row in conn.execute('SELECT * FROM tasks ORDER BY id')]\n"
        "def get_task(conn, task_id):\n"
        "    row = conn.execute('SELECT * FROM tasks WHERE id = ?', (task_id,)).fetchone()\n"
        "    return Task(row) if row else None\n"
        "def complete_task(conn, task_id, *, result=None, summary=None, force=False):\n"
        "    if not str(result or '').strip() and not str(summary or '').strip():\n"
        "        raise ValueError(f'completion blocked: {task_id} has no result or summary evidence')\n"
        "    cur = conn.execute(\"UPDATE tasks SET status = 'done', result = ? WHERE id = ?\", (result, task_id))\n"
        "    conn.commit()\n"
        "    return cur.rowcount == 1\n",
        encoding="utf-8",
    )
    import sqlite3
    conn = sqlite3.connect(db_path)
    conn.executescript(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, assignee TEXT, status TEXT, "
        "priority INTEGER, created_at INTEGER, started_at INTEGER, completed_at INTEGER, body TEXT, result TEXT);"
        "CREATE TABLE task_links (parent_id TEXT, child_id TEXT);"
        "CREATE TABLE task_events (task_id TEXT, created_at INTEGER);"
        "INSERT INTO tasks (id, title, status, priority, created_at) VALUES "
        "('ready1', 'Ship', 'ready', 1, 10), ('ready2', 'Other', 'ready', 1, 11);"
    )
    conn.commit()
    conn.close()

    sys.path.insert(0, str(pkg))
    saved = {name: sys.modules.pop(name) for name in list(sys.modules) if name == "hermes_cli" or name.startswith("hermes_cli.")}
    commands.reset_warnings()
    try:
        assert commands.load_symbol("hermes_cli.kanban_db", "connect", quiet=True) is None
        connect = commands.load_symbol("hermes_cli.kanban_db_connect", "connect")
        assert connect is not None and connect.__module__ == "hermes_cli.kanban_db_connect"
        assert kanban._symbol("connect") is connect
        assert kanban._symbol("list_tasks").__module__ == "hermes_cli.kanban_db"
        assert kanban.available() is True
        assert "kanban_db.connect is missing" not in caplog.text
        app, _state = _app()

        async def inner():
            async with Server(app) as server:
                assert server.session is not None
                async with server.session.get(
                    server.base + "/v1/overlay/kanban/board", headers=server.headers(),
                ) as resp:
                    assert resp.status == 200
                    body = await resp.json()
                ids = [task["id"] for column in body["columns"] for task in column["tasks"]]
                assert ids == ["ready1", "ready2"]
                async with server.session.patch(
                    server.base + "/v1/overlay/kanban/tasks/ready1",
                    headers=server.headers(),
                    json={"status": "done"},
                ) as resp:
                    assert resp.status == 200
                    patched = await resp.json()
                assert patched["task"]["status"] == "done"
                async with server.session.patch(
                    server.base + "/v1/overlay/kanban/tasks/ready2",
                    headers=server.headers(),
                    json={"status": "done", "result": "custom evidence"},
                ) as resp:
                    assert resp.status == 200
                import hermes_cli.kanban_db as kb

                def refuse(conn, task_id, *, result=None, summary=None, force=False):
                    raise ValueError(f"completion blocked: {task_id} has no result or summary evidence")

                kb.complete_task = refuse
                async with server.session.patch(
                    server.base + "/v1/overlay/kanban/tasks/ready2",
                    headers=server.headers(),
                    json={"status": "done"},
                ) as resp:
                    assert resp.status == 422
                    err = await resp.json()
                assert err["error"].startswith("completion blocked:")
                assert "overlay_slash_failed" not in err["error"]

        _run(inner())
        saved_db = sqlite3.connect(db_path)
        rows = dict(saved_db.execute("SELECT id, result FROM tasks"))
        saved_db.close()
        assert rows["ready1"] == "Moved to done from overlay"
        assert rows["ready2"] == "custom evidence"
    finally:
        sys.path.remove(str(pkg))
        for name in list(sys.modules):
            if name == "hermes_cli" or name.startswith("hermes_cli."):
                sys.modules.pop(name, None)
        sys.modules.update(saved)
