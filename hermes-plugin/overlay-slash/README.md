# overlay-slash

Hermes API server（埠 **8642**，包括 `/p/<profile>/...`）本身唔處理 `/plan`、`/<skill>` 呢類 slash command，只有 CLI、TUI 同 messaging gateway 先識。呢個 plugin 喺 **in-process** 模式下面，用 aiohttp middleware 幫 API server 展開呢啲指令，並提供 command + skill catalog，等 Hermes Overlay 可以彈出 `/` 選單。

The Hermes API server (port **8642**, including `/p/<profile>/...`) ignores slash commands such as `/plan` and `/<skill>`. This plugin, running **in-process**, expands them in an aiohttp middleware and serves a command + skill catalog so Hermes Overlay can show a `/` menu.

唔好用 `plugins.isolation: host`。嗰個模式冇 `register_platform_handler`。

Do not set `plugins.isolation: host`. That mode cannot register platform handlers.

## 安裝

裝入 **預設** Hermes home（multiplex gateway 係用啟動時嗰個 home 搵 plugin）。**安裝同 enable 之後一定要重啟 gateway。** Middleware 係喺 process 啟動、router freeze 之前先 append。Gateway 已經行緊嗰陣再 attach，aiohttp 會拋 `Cannot modify frozen list`，plugin 只係 log 呢句然後 no-op，唔會接上 route。`hermes plugins enable` 中途打開都係一樣，要重啟先生效。

Install into the **default** Hermes home (the multiplexed gateway discovers plugins from the home it was started with). **Restart the gateway after install and after enable.** The middleware is appended before the router freezes. Attaching while the gateway is already running raises `Cannot modify frozen list`; the plugin logs that and no-ops. A mid-run `hermes plugins enable` does not wire HTTP until restart.

無 TTY（script、CI）要加 `--yes-deps`，否則安裝會停喺 dependency consent。

Non-interactive installs must pass `--yes-deps`, or Hermes stops at the dependency prompt.

```bash
hermes plugins install https://github.com/freezemusic/Hermes-Overlay.git#hermes-plugin/overlay-slash --ref <sha> --enable --yes-deps
```

`<sha>` 用 40 位 commit。subpath install 會忽略 URL 入面嘅 branch 段，所以一定要 `--ref`。

`<sha>` is the 40-character commit. Subpath installs ignore a branch embedded in the URL; pin with `--ref`.

設定（`plugins.entries.overlay-slash.settings`，預設如下）：

| key | default | meaning |
|---|---|---|
| `rewrite_chat` | `true` | 展開 chat / completions / responses 入面嘅 prompt、skill、bundle |
| `fix_v1_skills` | `false` | 一併正確回應 `GET /v1/skills`（見下面嘅 500 bug）。預設關閉 |
| `allow_init` | `false` | catalog 同展開包含 `/init`。預設關閉，因為佢掃嘅係 gateway process 嘅 cwd |

同名環境變數 `OVERLAY_SLASH_REWRITE_CHAT`、`OVERLAY_SLASH_FIX_V1_SKILLS`、`OVERLAY_SLASH_ALLOW_INIT` 會蓋過設定。

## API

兩個路徑都係同一套 handler。`/p/<profile>/` 由 Hermes 自己嘅 profile middleware 解析完，plugin 先跑。

Both shapes hit the same handlers, after Hermes has resolved `/p/<profile>/`:

- `GET /v1/overlay/commands`
- `GET /p/<profile>/v1/overlay/commands`
- `POST /v1/overlay/expand`
- `POST /p/<profile>/v1/overlay/expand`

要帶 gateway 嘅 `Authorization: Bearer <API_SERVER_KEY>`。plugin 呼叫 adapter 嘅 `_check_auth`；per-profile key 由 Hermes 揀。

Auth is the gateway `Authorization: Bearer <API_SERVER_KEY>`. The plugin calls the adapter `_check_auth`; the per-profile key is selected by Hermes.

### `GET .../v1/overlay/commands`

```json
{
  "object": "list",
  "profile": "default",
  "version": 1,
  "data": [
    {
      "name": "/plan",
      "kind": "prompt",
      "category": "Session",
      "description": "Write a markdown implementation plan to .hermes/plans/ without executing anything",
      "args_hint": "[task]",
      "aliases": [],
      "enabled": true
    },
    {
      "name": "/help",
      "kind": "reply",
      "category": "Info",
      "description": "Show available commands",
      "args_hint": "[skills|<filter>]",
      "aliases": [],
      "enabled": true
    },
    {
      "name": "/new",
      "kind": "client",
      "category": "Session",
      "description": "Start a new session (fresh session ID + history)",
      "args_hint": "[name]",
      "aliases": ["/reset"],
      "enabled": true,
      "maps_to": "POST /api/sessions"
    },
    {
      "name": "/arxiv",
      "kind": "skill",
      "category": "research",
      "description": "…",
      "args_hint": "[instruction]",
      "aliases": [],
      "enabled": true
    }
  ],
  "capabilities": {"kanban": false},
  "warning": ""
}
```

`kind`：

| kind | 行為 |
|---|---|
| `prompt` | 展開之後照送 agent。`/plan`、`/learn`、`/queue`、`/steer`（只剝前綴；`list/edit/rm/move/clear/add` 唔會當 agent turn）。`/init` 要 `allow_init` |
| `skill` | 已安裝 skill（可疊加，跟 Hermes，最多 5 個）。`enabled: false` 係 `api_server` 停用咗 |
| `bundle` | skill bundle |
| `reply` | 唔開 agent turn。`/help`、`/commands`、`/version`（alias `/v`）、`/profile`、`/bundles`、`/egress` |
| `client` | Overlay 自己對現有 endpoint，唔好當聊天送出。`/new` → `POST /api/sessions`；`/title` → `PATCH /api/sessions/{id}`；`/branch`（`/fork`）→ `POST /api/sessions/{id}/fork`；`/model` → `POST /api/sessions/{id}/model`（選項係 `GET /api/model/options`）；`/stop` → overlay 現有嘅 stop（`maps_to` 係 `overlay stop`） |
| `plugin` | 其他 plugin 嘅 `register_command`。直接回覆，唔開 agent turn |

Catalog **唔會**列出 CLI-only（`/clear`、`/quit`…）、messaging-only（`/approve`、`/deny`、`/platform`…），同埋會改 agent 狀態但又冇 API 嘅指令（`/compress`、`/rollback`、`/undo`、`/retry`、`/yolo`、`/reasoning`、`/voice`、`/goal`、`/loop`、`/moa`、`/review`…）。

回應有 `ETag`。`If-None-Match` 相同就 `304`。

Skill 清單唔經會 500 嘅 `GET /v1/skills`（佢傳 `include_editorial=True`，但 `_find_all_skills` 未收呢個參數）。plugin 直接叫 `_find_all_skills(skip_disabled=False)` 同 `_sort_skills`。只有函式簽名接受 `include_editorial` 先會傳。`enabled` 用 `get_disabled_skill_names(platform="api_server")`。

Gateway 行緊先裝嘅 skill，filesystem scan 會見到，但 Hermes 嘅 slash map 係 process cache。Catalog 如果見到一個 enabled skill 唔喺 map 入面，會呼叫 `reload_skills()` 一次再列。`/expand` 同 chat 改寫喺 `resolve_skill_command_key` miss 時同樣 reload 一次再試。Reload 之後仍然 resolve 唔到嘅 enabled skill 唔會留喺 catalog。

### `POST .../v1/overlay/expand`

Request: `{"text": "/plan add dark mode"}`。可選 `session_id`（skill loader 嘅 task id）。

Prompt / skill / bundle：

```json
{
  "kind": "prompt",
  "command": "plan",
  "message": "[/plan — plan mode]\n…",
  "display": "/plan add dark mode",
  "notice": "Planning: add dark mode"
}
```

Skill 嘅 `kind` 係 `"skill"`，`command` 係 slug（疊加係 `arxiv+pdf`）。Bundle 嘅 `kind` 係 `"bundle"`。

直接回覆：

```json
{"kind": "reply", "command": "version", "text": "…", "format": "plain", "display": "/version"}
```

Plugin command 用 `"kind": "plugin"`，同樣有 `text`。Client：

```json
{"kind": "client", "command": "new", "display": "/new", "maps_to": "POST /api/sessions", "notice": "Handled by the overlay (POST /api/sessions)"}
```

唔係指令，或者 `//` 跳脫（原文照送，唔會剝成 `/plan`）：

```json
{"kind": "none"}
```

錯誤：

| status | code | when |
|---|---|---|
| 400 | `invalid_json` | body 唔係 JSON object |
| 422 | `invalid_text` | 冇有 string `text` |
| 404 | `unknown_command` | `/foo` 唔係 API-safe command、skill、bundle 或 plugin command |
| 409 | `skill_disabled` | skill 喺 `api_server` 停用 |
| 422 | `skill_load_failed` / `bundle_load_failed` / `plugin_failed` / `expand_failed` | 搵到但載入失敗，或 builder 拋錯 |

```json
{"error": {"message": "…", "type": "overlay_slash_error", "code": "skill_disabled", "command": "arxiv"}}
```

### 透明改寫（`rewrite_chat`，預設開）

以下 POST 嘅 user 文字如果係上面嘅 prompt / skill / bundle，body 會換成展開後嘅 `message`，回應加 `X-Hermes-Command`：

- `/api/sessions/{id}/chat` 同 `/chat/stream` 嘅 `message` 或 `input`（`message` 優先，同 Hermes 一樣）
- `/v1/chat/completions` 最後一條 `role=user` 嘅 `content`（string，或單一 text part）
- `/v1/responses` 嘅 `input`（string，或最後一個 item）

`/p/<profile>` 前綴同樣適用。

`X-Hermes-Command` 嘅值：`plan`、`learn`、`queue`、`steer`、`init`、`skill:<slug>`（疊加 `skill:arxiv+pdf`）、`bundle:<slug>`、reply/plugin/client 就係 command 名。

Reply、plugin、client **唔會**開 agent turn：

- `/chat/stream`，或者 body `stream: true`：短 SSE，唔寫入 session。順序同 Hermes session stream 一樣：`run.started`、`message.started`、`assistant.delta`、`assistant.completed`、`run.completed`、`done`。每個 event 都有 `session_id`、`run_id`、`seq`（由 1 起）、`ts`。`message.started` 嘅 `message.id` 同後面嘅 `message_id` 相同。`assistant.completed` 同 `run.completed` 帶 `completed: true`、`partial: false`、`interrupted: false`。
- 其他：JSON。session chat 係 `{"object":"hermes.session.chat.completion","message":{"role":"assistant","content":"…"},"usage":{}}`。completions 係 OpenAI `chat.completion`。responses 係 `output[].content[].text`。

寫入 history 嘅係展開後嘅正文，第一行係機器可讀 marker（一行，放最前，模型當 HTML comment 即可）：

```text
<!-- overlay-slash: {"display":"/plan add dark mode","command":"plan"} -->
```

`display` 係使用者打嘅字，`command` 係 command 名（skill 係 slug，例如 `arxiv`；疊加係 `arxiv+pdf`）。JSON 冇多餘空白（`separators=(",", ":")`）。換行會變成空格，`-->` 會剝走，避免 comment 提前結束。下一行先係展開 prompt。`POST /v1/overlay/expand` 嘅 `message` **唔包含**呢行；只有 chat 改寫（會入 history 嗰份）先有。Overlay 重新載入 history 時讀第一行，氣泡顯示 `display`。

未知 `/foo` 同 `//escaped` **原樣通過**。`_check_auth` 唔係成功（包括冇呢個方法）時，chat 都原樣通過，等 Hermes 自己回 401。

任何 exception、或者冇 `_read_bytes`、或者對應 builder import 唔到：chat **原樣通過**，並 warning 一次。Builder 唔喺度時，`/plan`、`/learn`、`/init` 會用一段短 fallback prompt，唔會靜靜丟棄個指令。

### 可選 `GET /v1/skills`

`fix_v1_skills: true` 先會攔截 `GET [/p/<p>]/v1/skills`，回應同 Hermes 一樣：

```json
{"object": "list", "data": [{"name": "arxiv", "description": "…", "category": "research"}]}
```

Auth 失敗就交給原本嘅 handler。組裝失敗都係交返俾原本 handler。

`capabilities.kanban` 係 `true` 代表呢個 process import 到 `hermes_cli.kanban_db`，下面嘅 proxy 可以用。`false` 時嗰啲 route 回 `404 {"error":"kanban unavailable"}`。

`capabilities.kanban` is `true` when this process can import `hermes_cli.kanban_db`. Otherwise the proxy routes return `404 {"error":"kanban unavailable"}`.

## Kanban proxy

同 `/v1/overlay/commands` 一樣要 `Authorization: Bearer <API_SERVER_KEY>`。`/p/<profile>/...` 同樣適用。實作直接叫 `hermes_cli.kanban_db`（同 `plugins/kanban/dashboard/plugin_api.py`），冇 shell-out。可選 query `board=<slug>`；唔傳就用而家嘅 board。

Same Bearer auth as `/v1/overlay/commands`. `/p/<profile>/...` works too. Handlers call `hermes_cli.kanban_db` (the same module as `plugins/kanban/dashboard/plugin_api.py`). No shell-out. Optional query `board=<slug>`; omit it for the active board.

| method | path | response |
|---|---|---|
| GET | `/v1/overlay/kanban/boards` | `{"boards":[{"slug","is_current",…}],"current"}` |
| GET | `/v1/overlay/kanban/board?board=<slug>&include_archived=0` | `{"board","columns":[{"name","tasks":[{id,title,assignee,status,priority,updated_at,parents,children}]}]}` |
| GET | `/v1/overlay/kanban/tasks/{id}` | `{"task","comments","events"}`。`events` 最多最近 50 條 |
| PATCH | `/v1/overlay/kanban/tasks/{id}` | body `{status?, assignee?, priority?, title?, result?}` → `{"task":…}` |

欄位固定有 `triage`、`todo`、`ready`、`running`、`blocked`、`done`。有卡先至附加 `scheduled`、`review`；`include_archived=1` 先至附加 `archived`。`updated_at` 係建立／開始／完成時間同最新 event 入面最大嗰個 unix 秒。`parents`／`children` 係 task id。

PATCH 會驗證 `status`。`running` 唔可以人手設（dispatcher 先至 claim）。`archived` 同刪除唔喺呢個 API。未知 id 係 `404 {"error":"task not found"}`。遷移被拒（回傳 false）係 `409`。Hermes 拋錯（例如完成卡冇證據）係 `422`，body 係 `{"error":"<reason>"}`，唔會變 500。`status:"done"` 會叫 `complete_task`，並傳 `result`（body 冇就用 `Moved to done from overlay`）同同樣嘅 `summary`。

`connect` 喺 Hermes v0.21.6 係 `hermes_cli.kanban_db_connect.connect`，`kanban_db` 冇 re-export。Proxy 兩個模組都會搵 `connect`／`init_db`／`write_txn`。

A refused transition that returns false is `409`. A Hermes exception (for example completion with no evidence) is `422 {"error":"<reason>"}`, not 500. `status:"done"` calls `complete_task` with `result` (default `Moved to done from overlay`) and the same `summary`. On v0.21.6 `connect` lives in `hermes_cli.kanban_db_connect` and is not re-exported from `kanban_db`; the proxy checks both modules.

### 點解 chat agent 改到卡

`kanban_*` tools（`kanban_complete`、`kanban_block`、`kanban_comment`…）**唔會**因為開咗呢個 proxy 就出現。Hermes 只係喺下面其中一個情況註冊佢哋：

1. Dispatcher 起嘅 worker：環境變數 `HERMES_KANBAN_TASK` 有值（而且唔係 delegated child）。
2. Profile 嘅 `toolsets` 包含 `kanban`。
3. `platform_toolsets.<platform>` 包含 `kanban`。API server 嘅 platform 名係 `api_server`。explicit list 會取代預設 composite，所以要留低原本嘅 toolset：

```yaml
platform_toolsets:
  api_server:
    - hermes-api-server
    - kanban
```

呢個 plugin **唔會**改你嘅 `config.yaml`。改完要重啟 gateway，agent 先睇到新 toolset。

The `kanban_*` tools are not registered just because this proxy is installed. Hermes registers them only for a dispatcher worker (`HERMES_KANBAN_TASK` set, and not a delegated child), or when the profile lists `kanban` in `toolsets`, or in `platform_toolsets.<platform>`. For the API server that platform key is `api_server`. An explicit list replaces the default composite, so keep the existing toolset:

```yaml
platform_toolsets:
  api_server:
    - hermes-api-server
    - kanban
```

This plugin does not edit your config. Restart the gateway after changing it.

## 已知限制

- 依賴 Hermes 內部符號（`_check_auth`、aiohttp `request._read_bytes`、`build_plan_prompt` / `build_learn_prompt` / `build_skill_invocation_message` 同 skill catalog 嘅 module path）。符號唔見就降級，唔會拆 gateway。Hermes 升級之後要再對一次。
- 展開後嘅 prompt 會寫入 session history（同 messaging gateway 一樣），第一行係 `<!-- overlay-slash: {"display":"…","command":"…"} -->`。Overlay 用呢行還原使用者打嘅字。
- 安裝、enable、改設定之後要重啟 gateway。行緊嘅 process 會 log `Cannot modify frozen list` 然後唔接 middleware。
- 無 TTY 安裝要 `--yes-deps`。
- 必須 in-process。要裝喺預設 home，一個 API server 先服務到全部 `/p/<profile>`。
- `/queue`、`/steer` 喺 API 路徑只係剝前綴再送一 turn。Queue 管理子指令唔會改 Hermes 嘅 queue。
- `/init` 用 gateway 嘅 cwd，唔係 overlay 視窗嘅 workspace。
- Reply 嘅 SSE 用 Hermes session event 名，包括 `/v1/chat/completions` 同 `/v1/responses` 嘅 `stream: true`。唔係 OpenAI chunk 格式。
