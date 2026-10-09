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
