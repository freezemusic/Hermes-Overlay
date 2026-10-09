"""Catalog and slash expansion for the overlay-slash plugin.

Hermes internals are loaded by name and every lookup fails soft. Missing
builders fall back to a short local prompt (or an empty skill list) so a
newer Hermes that moved a symbol does not take down the API server.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Mapping

logger = logging.getLogger("overlay_slash")

CATALOG_VERSION = 1

_warned: set[str] = set()

# Agent-state commands the API server cannot apply. They stay out of the
# catalog and are not rewritten (the request is left for Hermes).
_MUTATING = frozenset({
    "compress", "compact", "rollback", "undo", "retry", "yolo", "reasoning",
    "voice", "goal", "subgoal", "loop", "proactive", "moa", "review", "refine",
    "personality", "fast", "approvals", "busy", "footer", "codex-runtime",
    "codex_runtime", "heartbeat", "hb", "kanban", "memory", "suggestions",
    "suggest", "blueprint", "bp", "curator", "reload-mcp", "reload_mcp",
    "reload-skills", "reload_skills", "resume", "save", "status", "context",
    "ctx", "whoami", "agents", "tasks", "bg", "btw", "usage", "insights",
    "login", "topup", "debug", "update", "diff", "sessions", "initiate-setup",
    "initiate_setup",
})

_QUEUE_VERBS = frozenset({"list", "edit", "rm", "move", "clear", "add", "status"})

_SKILL_INVALID_CHARS = re.compile(r"[^\w-]")
_SKILL_MULTI_HYPHEN = re.compile(r"-{2,}")
_PROFILE_RE = re.compile(r"^/p/([^/]+)(?=/)")
_SESSION_RE = re.compile(r"/api/sessions/([^/]+)/")


def warn_once(key: str, message: str) -> None:
    if key in _warned:
        return
    _warned.add(key)
    logger.warning("%s", message)


def reset_warnings() -> None:
    """Test hook. Production code never clears the set."""
    _warned.clear()


def load_symbol(module: str, name: str) -> Any:
    """Import ``module.name``. Return None and warn once on any failure."""
    try:
        import importlib
        mod = importlib.import_module(module)
        value = getattr(mod, name, None)
    except Exception as exc:
        warn_once(
            f"import:{module}.{name}",
            f"overlay-slash: {module}.{name} unavailable ({type(exc).__name__}: {exc})",
        )
        return None
    if value is None:
        warn_once(
            f"import:{module}.{name}",
            f"overlay-slash: {module}.{name} is missing; that feature will be skipped",
        )
    return value


def accepts_param(fn: Any, name: str) -> bool:
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
    if name in params:
        return True
    return any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


@dataclass
class Settings:
    rewrite_chat: bool = True
    fix_v1_skills: bool = False
    allow_init: bool = False

    @classmethod
    def from_ctx(cls, ctx: Any = None) -> "Settings":
        def read(key: str, default: bool) -> bool:
            env = os.environ.get(f"OVERLAY_SLASH_{key.upper()}")
            if env is not None and env.strip() != "":
                return _as_bool(env, default)
            if ctx is not None and hasattr(ctx, "get_config"):
                try:
                    return _as_bool(ctx.get_config(key, default), default)
                except Exception as exc:
                    warn_once(
                        "config",
                        f"overlay-slash: get_config({key}) failed ({exc}); using defaults",
                    )
            return default

        return cls(
            rewrite_chat=read("rewrite_chat", True),
            fix_v1_skills=read("fix_v1_skills", False),
            allow_init=read("allow_init", False),
        )


@dataclass
class ExpandError(Exception):
    status: int
    code: str
    message: str
    command: str = ""

    def __str__(self) -> str:
        return self.message


@dataclass
class Expansion:
    kind: str
    command: str = ""
    message: str = ""
    display: str = ""
    notice: str = ""
    text: str = ""
    format: str = "markdown"
    maps_to: str = ""
    enabled: bool = True

    def header_value(self) -> str:
        if self.kind == "skill" and self.command:
            return f"skill:{self.command}"
        if self.kind == "bundle" and self.command:
            return f"bundle:{self.command}"
        return self.command or self.kind

    def to_json(self) -> dict[str, Any]:
        if self.kind == "none":
            return {"kind": "none"}
        if self.kind == "reply":
            return {
                "kind": "reply",
                "command": self.command,
                "text": self.text,
                "format": self.format,
                "display": self.display,
            }
        if self.kind == "plugin":
            return {
                "kind": "plugin",
                "command": self.command,
                "text": self.text,
                "format": self.format or "markdown",
                "display": self.display,
            }
        if self.kind == "client":
            body: dict[str, Any] = {
                "kind": "client",
                "command": self.command,
                "display": self.display,
                "maps_to": self.maps_to,
            }
            if self.notice:
                body["notice"] = self.notice
            return body
        body = {
            "kind": self.kind,
            "command": self.command,
            "message": self.message,
            "display": self.display,
            "notice": self.notice,
        }
        return body


@dataclass(frozen=True)
class _Builtin:
    kind: str
    name: str
    category: str
    description: str
    args_hint: str = ""
    aliases: tuple[str, ...] = ()
    maps_to: str = ""
    opt_in: str = ""  # settings flag that must be true


# English source strings match Hermes v0.21.6 COMMAND_REGISTRY. Live
# CommandDef.describe() replaces them when that module imports.
_BUILTINS: tuple[_Builtin, ...] = (
    _Builtin("prompt", "plan", "Session",
             "Write a markdown implementation plan to .hermes/plans/ without executing anything",
             "[task]"),
    _Builtin("prompt", "learn", "Tools & Skills",
             "Learn a reusable skill from anything you describe (dirs, URLs, this chat, notes)",
             "<what>"),
    _Builtin("prompt", "queue", "Session",
             "Queue a prompt for the next turn, or list/edit/rm/move/clear queued prompts",
             "[prompt|list|edit N |rm N|move A B|clear]", ("q",)),
    _Builtin("prompt", "steer", "Session",
             "Inject a message after the next tool call without interrupting",
             "<prompt>", ("s",)),
    _Builtin("prompt", "init", "Tools & Skills",
             "Generate or update AGENTS.md project instructions from a repo scan",
             "[notes]", opt_in="allow_init"),
    _Builtin("reply", "help", "Info",
             "Show available commands (/help skills lists skill commands, /help <filter> filters)",
             "[skills|<filter>]"),
    _Builtin("reply", "commands", "Info",
             "Browse all commands and skills (paginated)", "[page]"),
    _Builtin("reply", "version", "Info", "Show Hermes Agent version", "", ("v",)),
    _Builtin("reply", "profile", "Info", "Show active profile name and home directory"),
    _Builtin("reply", "bundles", "Tools & Skills",
             "List skill bundles (aliases / for multiple skills)"),
    _Builtin("reply", "egress", "Session", "Show Docker egress proxy status", "[status]"),
    _Builtin("client", "new", "Session",
             "Start a new session (fresh session ID + history)", "[name]", ("reset",),
             "POST /api/sessions"),
    _Builtin("client", "title", "Session", "Set a title for the current session",
             "[name]", maps_to="PATCH /api/sessions/{id}"),
    _Builtin("client", "branch", "Session",
             "Branch the current session (new thread on Discord/Telegram/Slack/Matrix; --here stays here)",
             "[--here] [name]", ("fork",), "POST /api/sessions/{id}/fork"),
    _Builtin("client", "model", "Configuration",
             "Switch model (session-scoped; --global to persist)",
             "[model] [--provider name] [--reasoning level] [--global|--session] [--refresh]",
             maps_to="POST /api/sessions/{id}/model"),
    _Builtin("client", "stop", "Session", "Kill all running background processes",
             maps_to="overlay stop"),
)

_EXECUTE_NAME = {
    "help": "help",
    "commands": "commands",
    "version": "version",
    "profile": "profile",
    "bundles": "bundles",
    "egress": "egress",
}


def _live_command(name: str) -> Any:
    resolve = load_symbol("hermes_cli.commands", "resolve_command")
    if resolve is None:
        return None
    try:
        return resolve(name)
    except Exception as exc:
        warn_once(f"resolve:{name}", f"overlay-slash: resolve_command({name}) failed ({exc})")
        return None


def _builtin_row(spec: _Builtin) -> dict[str, Any]:
    description, args_hint, aliases, category = (
        spec.description, spec.args_hint, list(spec.aliases), spec.category,
    )
    live = _live_command(spec.name)
    if live is not None:
        try:
            description = str(live.describe() or description)
        except Exception:
            description = str(getattr(live, "description", None) or description)
        args_hint = str(getattr(live, "args_hint", None) or args_hint)
        raw_aliases = getattr(live, "aliases", None) or aliases
        aliases = [str(a) for a in raw_aliases]
        category = str(getattr(live, "category", None) or category)
    row = {
        "name": f"/{spec.name}",
        "kind": spec.kind,
        "category": category,
        "description": description,
        "args_hint": args_hint,
        "aliases": [f"/{a}" if not str(a).startswith("/") else str(a) for a in aliases],
        "enabled": True,
    }
    if spec.maps_to:
        row["maps_to"] = spec.maps_to
    return row


def active_builtins(settings: Settings) -> list[_Builtin]:
    out: list[_Builtin] = []
    for spec in _BUILTINS:
        if spec.opt_in and not getattr(settings, spec.opt_in, False):
            continue
        if spec.name in _MUTATING:
            continue
        out.append(spec)
    return out


def _builtin_index(settings: Settings) -> dict[str, _Builtin]:
    index: dict[str, _Builtin] = {}
    for spec in active_builtins(settings):
        index[spec.name] = spec
        for alias in spec.aliases:
            index[alias.lower().lstrip("/")] = spec
    return index


def _slug(name: str, slugify: Callable | None = None) -> str:
    if slugify is not None:
        try:
            slug = slugify(name)
            if slug:
                return str(slug).lstrip("/").lower()
        except Exception as exc:
            warn_once("slugify", f"overlay-slash: slugify_skill_name failed ({exc})")
    cmd = _SKILL_INVALID_CHARS.sub("", (name or "").lower().replace(" ", "-").replace("_", "-"))
    return _SKILL_MULTI_HYPHEN.sub("-", cmd).strip("-")


def _claimed_names(rows: list[dict[str, Any]]) -> set[str]:
    claimed: set[str] = set()
    for row in rows:
        claimed.add(str(row["name"]).lstrip("/").lower())
        for alias in row.get("aliases") or []:
            claimed.add(str(alias).lstrip("/").lower())
    return claimed


def current_profile_from_path(path: str) -> str:
    match = _PROFILE_RE.match(path or "")
    return match.group(1) if match else "default"


def request_profile(request: Any) -> str:
    var = load_symbol("gateway.platforms.api_server", "_api_request_profile")
    if var is not None:
        try:
            value = var.get()
        except Exception:
            value = None
        if value:
            return str(value)
    path = getattr(request, "path", "") or ""
    return current_profile_from_path(path)


def current_home() -> str | None:
    fn = load_symbol("hermes_constants", "get_hermes_home")
    if fn is None:
        return None
    try:
        home = fn()
    except Exception as exc:
        warn_once("home-get", f"overlay-slash: get_hermes_home failed ({exc})")
        return None
    return str(home) if home else None


def call_in_home(home: str | None, fn: Callable, *args: Any, **kwargs: Any) -> Any:
    """Run ``fn`` with Hermes' profile home override, the same way skill_commands does."""
    set_ov = load_symbol("hermes_constants", "set_hermes_home_override")
    reset_ov = load_symbol("hermes_constants", "reset_hermes_home_override")
    token = None
    try:
        if home is not None and set_ov is not None:
            try:
                token = set_ov(str(home))
            except Exception as exc:
                warn_once("home-set", f"overlay-slash: set_hermes_home_override failed ({exc})")
                token = None
        return fn(*args, **kwargs)
    finally:
        if token is not None and reset_ov is not None:
            try:
                reset_ov(token)
            except Exception as exc:
                warn_once("home-reset", f"overlay-slash: reset_hermes_home_override failed ({exc})")


def strip_profile(path: str) -> str:
    path = (path or "").split("?", 1)[0]
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    match = re.match(r"^/p/[^/]+(/.*)$", path)
    if match:
        path = match.group(1) or "/"
    return path or "/"


def session_id_from_path(path: str) -> str | None:
    match = _SESSION_RE.search(path or "")
    return match.group(1) if match else None


def _entry(name: str, kind: str, category: str, description: str, *,
           args_hint: str = "", aliases: list[str] | None = None, enabled: bool = True,
           extra: Mapping[str, Any] | None = None) -> dict[str, Any]:
    row = {
        "name": name if name.startswith("/") else f"/{name}",
        "kind": kind,
        "category": category or "",
        "description": description or "",
        "args_hint": args_hint or "",
        "aliases": list(aliases or []),
        "enabled": bool(enabled),
    }
    if extra:
        row.update(extra)
    return row


def _find_skills() -> list[dict[str, Any]]:
    find = load_symbol("tools.skills_tool", "_find_all_skills")
    sort = load_symbol("tools.skills_tool", "_sort_skills")
    if find is None:
        return []
    kwargs: dict[str, Any] = {"skip_disabled": False}
    if accepts_param(find, "include_editorial"):
        kwargs["include_editorial"] = True
    try:
        found = find(**kwargs)
    except TypeError:
        kwargs.pop("include_editorial", None)
        try:
            found = find(**kwargs)
        except Exception as exc:
            warn_once("skills-find", f"overlay-slash: _find_all_skills failed ({exc})")
            return []
    except Exception as exc:
        warn_once("skills-find", f"overlay-slash: _find_all_skills failed ({exc})")
        return []
    if not isinstance(found, list):
        return []
    if sort is not None:
        try:
            found = sort(found)
        except Exception as exc:
            warn_once("skills-sort", f"overlay-slash: _sort_skills failed ({exc})")
    return [s for s in found if isinstance(s, dict)]


def _disabled_names() -> set[str]:
    fn = load_symbol("agent.skill_utils", "get_disabled_skill_names")
    if fn is None:
        return set()
    try:
        if accepts_param(fn, "platform"):
            names = fn(platform="api_server")
        else:
            names = fn()
    except TypeError:
        try:
            names = fn()
        except Exception as exc:
            warn_once("disabled", f"overlay-slash: get_disabled_skill_names failed ({exc})")
            return set()
    except Exception as exc:
        warn_once("disabled", f"overlay-slash: get_disabled_skill_names failed ({exc})")
        return set()
    return {str(n) for n in (names or ())}


def skill_rows(claimed: set[str]) -> tuple[list[dict[str, Any]], str]:
    warning = ""
    try:
        disabled = _disabled_names()
        slugify = load_symbol("agent.skill_commands", "slugify_skill_name")
        collision = load_symbol("agent.skill_commands", "skill_command_collision_note")
        interactive_fn = load_symbol("agent.skill_commands", "get_interactive_skill_commands")
        found = _find_skills()
        interactive: dict[str, Any] = {}
        if interactive_fn is not None:
            try:
                interactive = interactive_fn() or {}
            except Exception as exc:
                warning = f"skill command scan unavailable: {exc}"
                warn_once("skills-interactive", f"overlay-slash: {warning}")
        by_name = {}
        for key, info in interactive.items():
            if isinstance(info, dict):
                by_name[str(info.get("name") or key.lstrip("/")).lower()] = (str(key), info)
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        for skill in found:
            name = str(skill.get("name") or "").strip()
            if not name:
                continue
            mapped = by_name.get(name.lower())
            slug = mapped[0].lstrip("/") if mapped else _slug(name, slugify)
            if not slug or slug in claimed or slug in seen:
                continue
            if collision is not None:
                try:
                    if collision(name):
                        continue
                except Exception:
                    pass
            seen.add(slug)
            enabled = name not in disabled and slug not in disabled
            rows.append(_entry(
                f"/{slug}", "skill", str(skill.get("category") or ""),
                str(skill.get("description") or f"Invoke the {name} skill"),
                args_hint="[instruction]", enabled=enabled,
            ))
        for key in sorted(interactive):
            info = interactive.get(key) or {}
            if not isinstance(info, dict):
                continue
            slug = str(key).lstrip("/").lower()
            if not slug or slug in claimed or slug in seen:
                continue
            name = str(info.get("name") or slug)
            if collision is not None:
                try:
                    if collision(name):
                        continue
                except Exception:
                    pass
            seen.add(slug)
            rows.append(_entry(
                f"/{slug}", "skill", str(info.get("category") or "Skills"),
                str(info.get("description") or f"Invoke the {name} skill"),
                args_hint="[instruction]",
                enabled=name not in disabled and slug not in disabled,
            ))
        return rows, warning
    except Exception as exc:
        warn_once("skills", f"overlay-slash: skill catalog failed ({exc})")
        return [], f"skill discovery unavailable: {exc}"


def bundle_rows(claimed: set[str]) -> tuple[list[dict[str, Any]], str]:
    fn = load_symbol("agent.skill_bundles", "get_skill_bundles")
    if fn is None:
        return [], ""
    try:
        bundles = fn() or {}
    except Exception as exc:
        warn_once("bundles", f"overlay-slash: get_skill_bundles failed ({exc})")
        return [], f"bundle discovery unavailable: {exc}"
    rows: list[dict[str, Any]] = []
    if not isinstance(bundles, dict):
        return rows, ""
    for key in sorted(bundles):
        info = bundles[key] or {}
        if not isinstance(info, dict):
            continue
        slug = str(info.get("slug") or str(key).lstrip("/")).lower()
        if not slug or slug in claimed:
            continue
        rows.append(_entry(
            f"/{slug}", "bundle", "Bundles",
            str(info.get("description") or "Skill bundle"),
            args_hint="[instruction]",
        ))
        claimed.add(slug)
    return rows, ""


def plugin_rows(claimed: set[str]) -> tuple[list[dict[str, Any]], str]:
    fn = load_symbol("hermes_cli.plugins", "get_plugin_commands")
    if fn is None:
        return [], ""
    try:
        commands = fn() or {}
    except Exception as exc:
        warn_once("plugins", f"overlay-slash: get_plugin_commands failed ({exc})")
        return [], f"plugin command discovery unavailable: {exc}"
    rows: list[dict[str, Any]] = []
    if not isinstance(commands, dict):
        return rows, ""
    for name in sorted(commands):
        info = commands[name]
        if not isinstance(name, str) or not isinstance(info, dict):
            continue
        slug = name.lower().strip().lstrip("/")
        if not slug or slug in claimed or slug in _MUTATING:
            continue
        live = _live_command(slug)
        if live is not None and (getattr(live, "cli_only", False) or getattr(live, "gateway_only", False)):
            continue
        rows.append(_entry(
            f"/{slug}", "plugin", "Plugin commands",
            str(info.get("description") or "Plugin command"),
            args_hint=str(info.get("args_hint") or ""),
        ))
        claimed.add(slug)
    return rows, ""


def build_catalog(profile: str, home: str | None, settings: Settings) -> dict[str, Any]:
    def _build() -> dict[str, Any]:
        warnings: list[str] = []
        data = [_builtin_row(spec) for spec in active_builtins(settings)]
        claimed = _claimed_names(data)
        plugins, plugin_warning = plugin_rows(claimed)
        if plugin_warning:
            warnings.append(plugin_warning)
        claimed = _claimed_names(data + plugins)
        bundles, bundle_warning = bundle_rows(claimed)
        if bundle_warning:
            warnings.append(bundle_warning)
        claimed = _claimed_names(data + plugins + bundles)
        skills, skill_warning = skill_rows(claimed)
        if skill_warning:
            warnings.append(skill_warning)
        prompts = [row for row in data if row["kind"] == "prompt"]
        replies = [row for row in data if row["kind"] == "reply"]
        clients = [row for row in data if row["kind"] == "client"]
        return {
            "object": "list",
            "profile": profile or "default",
            "version": CATALOG_VERSION,
            "data": prompts + replies + clients + skills + bundles + plugins,
            "warning": "; ".join(w for w in warnings if w),
        }

    return call_in_home(home, _build)


def catalog_etag(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:32]


def _fallback_plan(task: str) -> str:
    task = (task or "").strip()
    block = f"Task to plan:\n{task}\n" if task else (
        "No explicit task was given with /plan — infer the task from the conversation.\n"
    )
    return "[/plan — plan mode]\n\n" + block


def _fallback_learn(user_request: str) -> str:
    req = (user_request or "").strip() or "the workflow we just went through in this conversation"
    return f"[/learn] The user wants you to learn a reusable skill from the request below.\n\nTHE REQUEST:\n{req}\n"


def plan_prompt(task: str) -> str:
    fn = load_symbol("agent.plan_prompt", "build_plan_prompt")
    if fn is None:
        warn_once("plan-fallback", "overlay-slash: build_plan_prompt missing; using a minimal plan prompt")
        return _fallback_plan(task)
    return fn(task)


def learn_prompt(user_request: str) -> str:
    fn = load_symbol("agent.learn_prompt", "build_learn_prompt")
    if fn is None:
        warn_once("learn-fallback", "overlay-slash: build_learn_prompt missing; using a minimal learn prompt")
        return _fallback_learn(user_request)
    return fn(user_request)


def init_prompt(extra: str, session_key: str | None) -> str:
    fn = load_symbol("hermes_cli.init_command", "build_init_prompt_for_cwd")
    if fn is None:
        warn_once("init-fallback", "overlay-slash: build_init_prompt_for_cwd missing; using a minimal init prompt")
        note = (extra or "").strip()
        return f"[/init]\nGenerate or update AGENTS.md from the gateway working directory.\n{note}".rstrip()
    if accepts_param(fn, "extra"):
        return fn(extra=extra or "", cwd=None, session_key=session_key)
    return fn(extra or "")


def _reply_fallback(name: str, args: str, profile: str) -> tuple[str, str]:
    if name == "version":
        return "Hermes Agent (version unavailable to overlay-slash)", "plain"
    if name == "profile":
        return f"Profile: {profile or 'default'}", "plain"
    if name == "help":
        names = ", ".join(f"/{spec.name}" for spec in _BUILTINS if not spec.opt_in)
        return f"API-safe commands: {names}", "markdown"
    if name == "commands":
        return _reply_fallback("help", args, profile)[0], "markdown"
    if name == "bundles":
        return "No skill bundles are visible to overlay-slash.", "plain"
    if name == "egress":
        return "Egress status is unavailable to overlay-slash.", "plain"
    return f"/{name} {args}".strip(), "plain"


def run_reply(name: str, args: str, profile: str) -> tuple[str, str]:
    execute = load_symbol("hermes_cli.slash_exec", "execute_command")
    context_cls = load_symbol("hermes_cli.slash_exec", "CommandContext")
    if execute is None or context_cls is None:
        warn_once(f"reply:{name}", f"overlay-slash: slash executor for /{name} unavailable; using a short reply")
        return _reply_fallback(name, args, profile)
    try:
        ctx = context_cls(surface="gateway", args=args or "", options={
            "profile_name": profile or "default",
            "page_size": 20,
        })
        reply = execute(name, ctx)
    except Exception as exc:
        warn_once(f"reply:{name}", f"overlay-slash: execute_command({name}) failed ({exc})")
        return _reply_fallback(name, args, profile)
    text = getattr(reply, "text", None)
    if text is None:
        text = str(reply)
    fmt = getattr(reply, "format", None) or "plain"
    return str(text), str(fmt)


def _plugin_handler(name: str) -> Any:
    fn = load_symbol("hermes_cli.plugins", "get_plugin_command_handler")
    if fn is None:
        return None
    try:
        return fn(name)
    except Exception as exc:
        warn_once(f"plugin-handler:{name}", f"overlay-slash: plugin handler lookup failed ({exc})")
        return None


def _invoke_plugin(handler: Callable, args: str) -> str:
    resolver = load_symbol("hermes_cli.plugins", "resolve_plugin_command_result")
    result = handler(args)
    if resolver is not None:
        result = resolver(result)
    elif inspect.isawaitable(result):
        result = asyncio.run(result)
    return "" if result is None else str(result)


def _disabled_skill_token(token: str) -> str | None:
    disabled = _disabled_names()
    if not disabled:
        return None
    slugify = load_symbol("agent.skill_commands", "slugify_skill_name")
    token_l = token.lower()
    for name in disabled:
        if name.lower() == token_l or _slug(name, slugify) == token_l:
            return name
    return None


def _expand_skill(token: str, args: str, task_id: str | None) -> Expansion:
    display = f"/{token}" + (f" {args}" if args else "")
    disabled = _disabled_skill_token(token)
    if disabled:
        raise ExpandError(409, "skill_disabled", f"Skill '{disabled}' is disabled for api_server", command=token)
    resolve = load_symbol("agent.skill_commands", "resolve_skill_command_key")
    if resolve is None:
        return Expansion("none")
    try:
        key = resolve(token, interactive=True) if accepts_param(resolve, "interactive") else resolve(token)
    except Exception as exc:
        warn_once("skill-resolve", f"overlay-slash: resolve_skill_command_key failed ({exc})")
        raise
    if not key:
        return Expansion("none")
    interactive = load_symbol("agent.skill_commands", "get_interactive_skill_commands")
    info: dict[str, Any] = {}
    if interactive is not None:
        try:
            info = (interactive() or {}).get(key) or {}
        except Exception as exc:
            warn_once("skills-interactive", f"overlay-slash: get_interactive_skill_commands failed ({exc})")
    skill_name = str(info.get("name") or str(key).lstrip("/"))
    if skill_name in _disabled_names() or str(key).lstrip("/") in _disabled_names():
        raise ExpandError(409, "skill_disabled", f"Skill '{skill_name}' is disabled for api_server", command=token)

    split = load_symbol("agent.skill_commands", "split_stacked_skill_commands")
    extra: list[str] = []
    instruction = args
    if split is not None:
        try:
            if accepts_param(split, "interactive"):
                extra, instruction = split(args, interactive=True)
            else:
                extra, instruction = split(args)
        except Exception as exc:
            warn_once("skill-stack", f"overlay-slash: split_stacked_skill_commands failed ({exc})")
            extra, instruction = [], args
    if extra:
        build = load_symbol("agent.skill_commands", "build_stacked_skill_invocation_message")
        if build is None:
            raise ExpandError(422, "skill_load_failed", "stacked skill builder is unavailable", command=token)
        result = build([key, *list(extra)], instruction, task_id=task_id) if accepts_param(build, "task_id") else build([key, *list(extra)], instruction)
        if not result:
            raise ExpandError(422, "skill_load_failed", f"failed to load stacked skills starting at {key}", command=token)
        message, loaded, missing = result[0], result[1], result[2] if len(result) > 2 else []
        slugs = "+".join(str(k).lstrip("/") for k in [key, *extra])
        notice = f"Loading {len(loaded)} stacked skills: {', '.join(loaded)}"
        if missing:
            notice += f"\nSkipped missing skills: {', '.join(missing)}"
        return Expansion("skill", command=slugs, message=str(message), display=display.strip(), notice=notice)

    build = load_symbol("agent.skill_commands", "build_skill_invocation_message")
    if build is None:
        raise ExpandError(422, "skill_load_failed", "skill builder is unavailable", command=token)
    if accepts_param(build, "task_id"):
        message = build(key, instruction, task_id=task_id)
    else:
        message = build(key, instruction)
    if not message:
        raise ExpandError(422, "skill_load_failed", f"failed to load skill {key}", command=token)
    return Expansion(
        "skill", command=str(key).lstrip("/"), message=str(message),
        display=display.strip(), notice=f"Loading skill: {skill_name}",
    )


def _expand_bundle(token: str, args: str, task_id: str | None) -> Expansion | None:
    resolve_cmd = load_symbol("hermes_cli.commands", "resolve_command")
    if resolve_cmd is not None:
        try:
            if resolve_cmd(token) is not None:
                return None
        except Exception:
            pass
    resolve = load_symbol("agent.skill_bundles", "resolve_bundle_command_key")
    if resolve is None:
        return None
    try:
        key = resolve(token)
    except Exception as exc:
        warn_once("bundle-resolve", f"overlay-slash: resolve_bundle_command_key failed ({exc})")
        return None
    if not key:
        return None
    build = load_symbol("agent.skill_bundles", "build_bundle_invocation_message")
    if build is None:
        raise ExpandError(422, "bundle_load_failed", "bundle builder is unavailable", command=token)
    kwargs: dict[str, Any] = {}
    if accepts_param(build, "task_id"):
        kwargs["task_id"] = task_id
    if accepts_param(build, "platform"):
        kwargs["platform"] = "api_server"
    result = build(key, args, **kwargs)
    if not result:
        raise ExpandError(422, "bundle_load_failed", f"failed to load bundle {key}", command=token)
    message, loaded, missing = result[0], result[1], result[2] if len(result) > 2 else []
    bundles = load_symbol("agent.skill_bundles", "get_skill_bundles")
    bundle_name = str(key).lstrip("/")
    if bundles is not None:
        try:
            bundle_name = str((bundles() or {}).get(key, {}).get("name") or bundle_name)
        except Exception:
            pass
    notice = f"Loading bundle: {bundle_name} ({len(loaded)} skills)"
    if missing:
        notice += f"\nSkipped missing skills: {', '.join(missing)}"
    display = f"/{token}" + (f" {args}" if args else "")
    return Expansion(
        "bundle", command=str(key).lstrip("/"), message=str(message),
        display=display.strip(), notice=notice,
    )


def _expand_sync(text: str, profile: str, settings: Settings, task_id: str | None, home: str | None) -> Expansion:
    def _inner() -> Expansion:
        raw = text if isinstance(text, str) else ""
        stripped = raw.strip()
        if not stripped.startswith("/") or stripped.startswith("//"):
            return Expansion("none", display=stripped)
        body = stripped[1:]
        token, _, args = body.partition(" ")
        token = token.strip()
        args = args.strip()
        if not token or "/" in token:
            return Expansion("none", display=stripped)
        spec = _builtin_index(settings).get(token.lower())
        if spec is not None:
            return _expand_builtin(spec, args, stripped, profile, task_id)
        handler = _plugin_handler(token.lower())
        if handler is not None:
            try:
                output = _invoke_plugin(handler, args)
            except Exception as exc:
                raise ExpandError(422, "plugin_failed", f"plugin command /{token} failed: {exc}", command=token) from exc
            return Expansion("plugin", command=token.lower(), text=output, display=stripped, format="markdown")
        bundle = _expand_bundle(token, args, task_id)
        if bundle is not None:
            return bundle
        if _disabled_skill_token(token):
            raise ExpandError(
                409, "skill_disabled",
                f"Skill '{token}' is disabled for api_server", command=token,
            )
        skill = _expand_skill(token, args, task_id)
        if skill.kind != "none":
            return skill
        raise ExpandError(404, "unknown_command", f"unknown command: /{token}", command=token)

    return call_in_home(home, _inner)


def _expand_builtin(spec: _Builtin, args: str, display: str, profile: str, task_id: str | None) -> Expansion:
    if spec.kind == "client":
        return Expansion("client", command=spec.name, display=display, maps_to=spec.maps_to,
                         notice=f"Handled by the overlay ({spec.maps_to})")
    if spec.kind == "reply":
        text, fmt = run_reply(_EXECUTE_NAME.get(spec.name, spec.name), args, profile)
        return Expansion("reply", command=spec.name, text=text, format=fmt, display=display)
    if spec.name in {"queue", "steer"}:
        if not args:
            usage = f"usage: /{spec.name} {spec.args_hint}".strip()
            return Expansion("reply", command=spec.name, text=usage, format="plain", display=display)
        if spec.name == "queue" and args.split(None, 1)[0].lower() in _QUEUE_VERBS:
            return Expansion(
                "reply", command="queue", format="plain", display=display,
                text="Queue management (list/edit/rm/move/clear/add) is not available on the API server.",
            )
        notice = f"Queued: {args}" if spec.name == "queue" else f"Steer: {args}"
        return Expansion("prompt", command=spec.name, message=args, display=display, notice=notice)
    if spec.name == "plan":
        message = plan_prompt(args)
        notice = f"Planning: {args}" if args else "Planning"
        return Expansion("prompt", command="plan", message=message, display=display, notice=notice)
    if spec.name == "learn":
        message = learn_prompt(args)
        notice = f"Learning: {args}" if args else "Learning"
        return Expansion("prompt", command="learn", message=message, display=display, notice=notice)
    if spec.name == "init":
        message = init_prompt(args, task_id)
        notice = f"Init: {args}" if args else "Init"
        return Expansion("prompt", command="init", message=message, display=display, notice=notice)
    raise ExpandError(404, "unknown_command", f"unknown command: /{spec.name}", command=spec.name)


async def expand_text(text: str, *, profile: str, settings: Settings, task_id: str | None = None) -> Expansion:
    home = current_home()
    return await asyncio.to_thread(_expand_sync, text, profile, settings, task_id, home)


def skills_list_payload(home: str | None = None) -> dict[str, Any]:
    """Body for the optional GET /v1/skills stand-in. Same shape as Hermes.

    ``home`` is captured on the event-loop thread (inside the profile scope)
    and applied in the worker via ``set_hermes_home_override``.
    """
    def _build() -> dict[str, Any]:
        skills = []
        for skill in _find_skills():
            name = skill.get("name")
            if not name:
                continue
            skills.append({
                "name": name,
                "description": skill.get("description") or "",
                "category": skill.get("category") or "",
            })
        return {"object": "list", "data": skills}

    return call_in_home(home, _build)


def _visible_text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    if isinstance(content, list) and len(content) == 1:
        part = content[0]
        if isinstance(part, str):
            return part
        if isinstance(part, dict) and isinstance(part.get("text"), str) and part.get("type", "text") in {"text", "input_text"}:
            return part["text"]
    if isinstance(content, dict) and isinstance(content.get("text"), str):
        return content["text"]
    return None


def _replace_text(content: Any, original: str, expanded: str) -> Any:
    if isinstance(content, str) and content.strip() == original.strip():
        return expanded
    if isinstance(content, list) and len(content) == 1:
        part = content[0]
        if isinstance(part, str) and part.strip() == original.strip():
            return [expanded]
        if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip() == original.strip():
            cloned = dict(part)
            cloned["text"] = expanded
            return [cloned]
    if isinstance(content, dict) and isinstance(content.get("text"), str) and content["text"].strip() == original.strip():
        cloned = dict(content)
        cloned["text"] = expanded
        return cloned
    return None


def extract_command_text(stripped_path: str, body: Mapping[str, Any]) -> str | None:
    if stripped_path.startswith("/api/sessions/"):
        message = body.get("message")
        if _visible_text(message):
            text = _visible_text(message)
        else:
            text = _visible_text(body.get("input"))
    elif stripped_path == "/v1/chat/completions":
        messages = body.get("messages")
        text = None
        if isinstance(messages, list):
            for msg in reversed(messages):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    text = _visible_text(msg.get("content"))
                    break
    elif stripped_path == "/v1/responses":
        raw = body.get("input")
        if isinstance(raw, str):
            text = raw
        elif isinstance(raw, list) and raw:
            last = raw[-1]
            text = last if isinstance(last, str) else _visible_text(last.get("content") if isinstance(last, dict) else None)
        else:
            text = None
    else:
        text = None
    if not isinstance(text, str) or not text.lstrip().startswith("/"):
        return None
    return text


def rewrite_body(stripped_path: str, body: dict[str, Any], expansion: Expansion) -> bool:
    if expansion.kind not in {"prompt", "skill", "bundle"} or not expansion.message:
        return False
    display = expansion.display or ""

    def put(container: dict, key: str) -> bool:
        replaced = _replace_text(container.get(key), display, expansion.message)
        if replaced is None:
            return False
        container[key] = replaced
        return True

    if stripped_path.startswith("/api/sessions/"):
        changed = put(body, "message") or put(body, "input")
        if isinstance(body.get("message"), str) and body["message"].strip() == display.strip():
            body["message"] = expansion.message
            changed = True
        if isinstance(body.get("input"), str) and body["input"].strip() == display.strip():
            body["input"] = expansion.message
            changed = True
        return changed
    if stripped_path == "/v1/chat/completions":
        messages = body.get("messages")
        if not isinstance(messages, list):
            return False
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                return put(msg, "content")
        return False
    if stripped_path == "/v1/responses":
        raw = body.get("input")
        if isinstance(raw, str) and raw.strip() == display.strip():
            body["input"] = expansion.message
            return True
        if isinstance(raw, list) and raw:
            last = raw[-1]
            if isinstance(last, str) and last.strip() == display.strip():
                raw[-1] = expansion.message
                return True
            if isinstance(last, dict):
                return put(last, "content")
        return False
    return False


def wants_stream(stripped_path: str, body: Mapping[str, Any]) -> bool:
    if stripped_path.endswith("/chat/stream"):
        return True
    value = body.get("stream")
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


def direct_reply_body(stripped_path: str, expansion: Expansion) -> dict[str, Any]:
    text = expansion.text or expansion.notice or ""
    if stripped_path == "/v1/chat/completions":
        return {
            "id": "chatcmpl-overlay-slash",
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }],
        }
    if stripped_path == "/v1/responses":
        return {
            "object": "response",
            "status": "completed",
            "output": [{
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            }],
        }
    return {
        "object": "hermes.session.chat.completion",
        "message": {"role": "assistant", "content": text},
        "usage": {},
    }


def sse_events(expansion: Expansion) -> list[tuple[str, dict[str, Any]]]:
    text = expansion.text or expansion.notice or ""
    return [
        ("run.started", {"user_message": {"role": "user", "content": expansion.display}}),
        ("assistant.delta", {"delta": text}),
        ("assistant.completed", {"content": text}),
        ("run.completed", {"content": text}),
        ("done", {}),
    ]


def error_payload(err: ExpandError) -> dict[str, Any]:
    return {
        "error": {
            "message": err.message,
            "type": "overlay_slash_error",
            "code": err.code,
            "command": err.command,
        }
    }


# Re-exported for tests that want the field set without importing private names.
__all__ = [
    "ExpandError",
    "Expansion",
    "Settings",
    "accepts_param",
    "build_catalog",
    "call_in_home",
    "catalog_etag",
    "current_home",
    "direct_reply_body",
    "error_payload",
    "expand_text",
    "extract_command_text",
    "json_bytes",
    "load_symbol",
    "request_profile",
    "reset_warnings",
    "rewrite_body",
    "skills_list_payload",
    "sse_events",
    "strip_profile",
    "wants_stream",
    "warn_once",
]
