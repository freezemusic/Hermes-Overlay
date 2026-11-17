# Proves Windows click-through by clicking a real window behind the overlay.
# Reading extended style is not the check.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$log = Join-Path $root "clickthrough-debug.log"
$tree = Join-Path $root "window-tree.txt"
$clickLog = Join-Path $env:TEMP "hermes-behind-clicks.txt"
$hwndFile = Join-Path $env:TEMP "hermes-behind-hwnd.txt"
$gwLog = Join-Path $env:TEMP "hermes-fake-gateway.log"
$dashLog = Join-Path $env:TEMP "hermes-fake-dashboard.log"
$dashErr = Join-Path $env:TEMP "hermes-fake-dashboard.err"
foreach ($path in @($log, $tree, $clickLog, $hwndFile, $gwLog, $dashLog, $dashErr)) {
  if (Test-Path $path) { Remove-Item $path -Force }
}

$exe = Get-ChildItem -Path "src-tauri\target\release" -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "hermes|Hermes" -and $_.FullName -notmatch "\\deps\\" } |
  Select-Object -First 1
if (-not $exe) {
  throw "release exe not found under src-tauri\target\release"
}

$hermesHome = Join-Path $env:TEMP "hermes-clickthrough-home"
New-Item -ItemType Directory -Force -Path $hermesHome | Out-Null
$configDir = Join-Path $env:APPDATA "com.freezemusic.hermes-overlay"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false
# The old gateway_base_url and per-bot base_url keys stay in this file on
# purpose: an old config must still load, and the app must never call them.
[System.IO.File]::WriteAllText((Join-Path $configDir "config.json"), @'
{
  "version": 1,
  "gateway_base_url": "http://127.0.0.1:8642",
  "dashboard_base_url": "http://127.0.0.1:9119",
  "kanban_base_url": "http://127.0.0.1:9119",
  "bots": [{
    "profile": "field",
    "display_name": "Field",
    "color": "#3366cc",
    "base_url": "",
    "detail": "",
    "session_id": "saved-field",
    "session_explicit": false,
    "session_anchor": 0.0,
    "enabled": true
  }],
  "suborb_pins": { "field": ["side-task"] },
  "interaction": {
    "modifier": "ctrl",
    "fade_enabled": true,
    "fade_distance": 120.0,
    "min_opacity": 0.18
  }
}
'@, $utf8)

$shared = [hashtable]::Synchronized(@{ Listener = $null })
$gwScript = {
  param($shared, $gwLog, $debugLog)
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:8642/")
  $shared.Listener = $listener
  $listener.Start()
  "listening" | Set-Content $gwLog
  try {
    while ($listener.IsListening) {
      $ctx = $null
      try { $ctx = $listener.GetContext() } catch { break }
      $path = $ctx.Request.Url.AbsolutePath
      $method = $ctx.Request.HttpMethod
      Add-Content $gwLog "$method $path"
      $body = '{"ok":true}'
      # Named profiles call /p/<profile>/api/sessions/..., not /api/sessions/...
      if ($path -like "*/messages*") {
        $body = '{"data":[{"role":"user","content":"/plan ship"},{"role":"assistant","content":"# Ship Implementation Plan\n\n**Goal:** keep click-through honest.\n\n- leave the plan rect\n- reopen from the chip\n\nFile: `.hermes/plans/ship.md`"}]}'
      } elseif ($path -like "*/api/sessions*") {
        $body = '{"data":[{"id":"bot-chat","title":"Bot Chat","source":"api_server","last_active":40},{"id":"saved-field","title":"notes","source":"api_server","last_active":10},{"id":"newest","title":"System Architect","source":"api_server","last_active":900}]}'
      } elseif ($path -like "*/health") {
        $body = '{"status":"ok"}'
      }
      $bytes = [Text.Encoding]::UTF8.GetBytes($body)
      $ctx.Response.StatusCode = 200
      $ctx.Response.ContentType = "application/json"
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    }
  } finally {
    try { $listener.Stop() } catch {}
    try { $listener.Close() } catch {}
  }
}
$gw = [powershell]::Create()
$gw.AddScript($gwScript).AddArgument($shared).AddArgument($gwLog).AddArgument($log) | Out-Null
$gwHandle = $gw.BeginInvoke()
$deadline = (Get-Date).AddSeconds(10)
while (-not (Test-Path $gwLog) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
if (-not (Test-Path $gwLog)) { throw "fake gateway did not start" }

# Chat runs on the Hermes Dashboard (9119) through HermesClient (R-CL-01):
# REST for sessions and history, one WebSocket for RPC. The 8642 fake above
# is a tripwire: since 2026-11-03 the app makes no gateway call at all
# (R-AR-04), so its log must stay at the "listening" line (no-gateway-calls). scripts/ci-fake-dashboard.mjs serves the same
# Bot Chat with the /plan history, so the field panel hosts the plan window.
$dashboard = Start-Process -FilePath "node" -ArgumentList @("scripts/ci-fake-dashboard.mjs", "9119", "`"$dashLog`"") `
  -WorkingDirectory $root -RedirectStandardError $dashErr -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(15)
while (-not ((Test-Path $dashLog) -and (Select-String -Path $dashLog -Pattern "^listening " -Quiet)) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 100
}
if (-not ((Test-Path $dashLog) -and (Select-String -Path $dashLog -Pattern "^listening " -Quiet))) {
  if (Test-Path $dashErr) { Get-Content $dashErr | Write-Host }
  throw "fake dashboard did not start"
}

$behindSrc = Join-Path $env:TEMP "HermesBehind.cs"
$behindExe = Join-Path $env:TEMP "HermesBehind.exe"
@'
using System;
using System.IO;
using System.Windows.Forms;
public class BehindForm : Form {
  readonly string clickLog;
  public BehindForm(string clickLog) {
    this.clickLog = clickLog;
    Text = "Behind";
    FormBorderStyle = FormBorderStyle.None;
    WindowState = FormWindowState.Maximized;
    TopMost = false;
    BackColor = System.Drawing.Color.White;
    MouseDown += (s, e) => {
      File.AppendAllText(clickLog, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "\n");
    };
  }
  [STAThread]
  public static void Main(string[] args) {
    string clicks = args.Length > 0 ? args[0] : "behind-clicks.txt";
    string hwndPath = args.Length > 1 ? args[1] : "behind-hwnd.txt";
    Application.EnableVisualStyles();
    var form = new BehindForm(clicks);
    form.Shown += (s, e) => File.WriteAllText(hwndPath, form.Handle.ToInt64().ToString());
    Application.Run(form);
  }
}
'@ | Set-Content -Encoding ascii $behindSrc
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:exe "/r:System.Windows.Forms.dll" "/r:System.Drawing.dll" "/out:$behindExe" $behindSrc
if ($LASTEXITCODE -ne 0) { throw "failed to compile Behind window" }
$behind = Start-Process -FilePath $behindExe -ArgumentList @($clickLog, $hwndFile) -PassThru
$deadline = (Get-Date).AddSeconds(10)
while (-not (Test-Path $hwndFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
if (-not (Test-Path $hwndFile)) { throw "Behind window did not report a hwnd" }
$behindHwnd = [IntPtr]([int64](Get-Content $hwndFile -Raw).Trim())

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class ClickProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32")] public static extern bool SetProcessDPIAware();
  [DllImport("user32")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32")] public static extern uint SendInput(uint n, INPUT[] inputs, int cb);
  [DllImport("user32")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public InputUnion u;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32")] public static extern bool GetCursorInfo(ref CURSORINFO info);
  [DllImport("user32", EntryPoint = "LoadCursorW")] public static extern IntPtr LoadSystemCursor(IntPtr inst, IntPtr id);
  public static long CursorId() {
    var info = new CURSORINFO();
    info.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
    if (!GetCursorInfo(ref info)) return 0;
    return info.hCursor.ToInt64();
  }
  public static long SystemCursor(int id) {
    return LoadSystemCursor(IntPtr.Zero, new IntPtr(id)).ToInt64();
  }
  public static void Nudge(int dx, int dy) {
    var move = new INPUT { type = INPUT_MOUSE };
    move.u.mi.dx = dx;
    move.u.mi.dy = dy;
    move.u.mi.dwFlags = MOUSEEVENTF_MOVE;
    SendInput(1, new[] { move }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string ClassName(IntPtr h) {
    var buf = new StringBuilder(256);
    GetClassName(h, buf, buf.Capacity);
    return buf.ToString();
  }
  public static string Title(IntPtr h) {
    var buf = new StringBuilder(256);
    GetWindowText(h, buf, buf.Capacity);
    return buf.ToString();
  }
  public static IntPtr HitAt(int x, int y) {
    return WindowFromPoint(new POINT { x = x, y = y });
  }
  public static void Click() {
    var down = new INPUT { type = INPUT_MOUSE };
    down.u.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    var up = new INPUT { type = INPUT_MOUSE };
    up.u.mi.dwFlags = MOUSEEVENTF_LEFTUP;
    SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
    SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32")] public static extern int GetSystemMetrics(int index);
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public static void Down() {
    var down = new INPUT { type = INPUT_MOUSE };
    down.u.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Up() {
    var up = new INPUT { type = INPUT_MOUSE };
    up.u.mi.dwFlags = MOUSEEVENTF_LEFTUP;
    SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
  }
  // A real move to a screen pixel (absolute SendInput, no pointer ballistics),
  // so a held button drags the way a hand does.
  public static void MoveTo(int x, int y) {
    int sw = Math.Max(2, GetSystemMetrics(0));
    int sh = Math.Max(2, GetSystemMetrics(1));
    var move = new INPUT { type = INPUT_MOUSE };
    move.u.mi.dx = (int)Math.Round(x * 65535.0 / (sw - 1));
    move.u.mi.dy = (int)Math.Round(y * 65535.0 / (sh - 1));
    move.u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    SendInput(1, new[] { move }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Ctrl(bool down) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.u.ki.wVk = 0x11;
    input.u.ki.dwFlags = down ? 0u : KEYEVENTF_KEYUP;
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Key(ushort vk, bool down) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.u.ki.wVk = vk;
    input.u.ki.dwFlags = down ? 0u : KEYEVENTF_KEYUP;
    SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Tap(ushort vk) {
    var down = new INPUT { type = INPUT_KEYBOARD };
    down.u.ki.wVk = vk;
    var up = new INPUT { type = INPUT_KEYBOARD };
    up.u.ki.wVk = vk;
    up.u.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, new[] { down }, Marshal.SizeOf(typeof(INPUT)));
    SendInput(1, new[] { up }, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL cred, uint flags);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  public static void StoreKey(string target, string user, string secret) {
    var bytes = System.Text.Encoding.Unicode.GetBytes(secret);
    var ptr = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, ptr, bytes.Length);
    var cred = new CREDENTIAL();
    cred.Type = 1;
    cred.TargetName = target;
    cred.UserName = user;
    cred.Comment = "hermes-overlay-clickthrough";
    cred.CredentialBlobSize = (uint)bytes.Length;
    cred.CredentialBlob = ptr;
    cred.Persist = 3;
    if (!CredWrite(ref cred, 0)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    Marshal.FreeHGlobal(ptr);
  }
  public static void Dump(string path) {
    var lines = new StringBuilder();
    EnumProc cb = null;
    cb = (hwnd, l) => {
      RECT rect;
      GetWindowRect(hwnd, out rect);
      lines.AppendFormat("{0} vis={1} class={2} title={3} {4},{5},{6}x{7}\n",
        hwnd, IsWindowVisible(hwnd) ? 1 : 0, ClassName(hwnd), Title(hwnd),
        rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      return true;
    };
    EnumWindows(cb, IntPtr.Zero);
    File.WriteAllText(path, lines.ToString());
    GC.KeepAlive(cb);
  }
}
"@

[ClickProbe]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$w = $bounds.Width
$h = $bounds.Height
# Same gap as interaction::work_area_insets. The window still covers Bounds.
# Settings, kanban, and cron centres move into the work area. The bottom
# disc centre is workArea.bottom - 12 - orb/2. The field probe stays on
# the full-monitor top edge at t=0.21 (R-AD-05).
$insetLeft = [Math]::Max(0, $work.X - $bounds.X)
$insetTop = [Math]::Max(0, $work.Y - $bounds.Y)
$insetRight = [Math]::Max(0, ($bounds.X + $bounds.Width) - ($work.X + $work.Width))
$insetBottom = [Math]::Max(0, ($bounds.Y + $bounds.Height) - ($work.Y + $work.Height))
$frameLeft = $insetLeft
$frameTop = $insetTop
$frameW = $w - $insetLeft - $insetRight
$frameH = $h - $insetTop - $insetBottom
$pad = 42
$orb = 44
$settings = @{ x = [int]($frameLeft + $frameW - $pad - 152 - $orb / 2); y = [int]($frameTop + $frameH - 12 - $orb / 2) }
$kanban = @{ x = [int]($frameLeft + $frameW / 2); y = [int]($frameTop + $pad + $orb / 2) }
$cron = @{ x = [int]($frameLeft + $frameW - $pad - $orb / 2); y = [int][Math]::Round($frameTop + $frameH * 0.38) }
# One field bot sits on the top edge (distributeEdges weight, t=0.21).
# Its open panel is 420x560 anchored on that orb. Settings is
# min(680, 92vw) by min(86vh, 760), anchored on the settings orb.
# The blank point has to miss both of those rects. On 1024x768,
# (200, h/2) is inside settings, so it is not a pass-through sample.
$field = @{ x = [int][Math]::Round($w * 0.08 + $w * 0.84 * 0.21); y = [int]($pad + $orb / 2) }
$settingsW = [Math]::Min(680.0, $w * 0.92)
$settingsH = [Math]::Min($h * 0.86, 760.0)
$orbR = $orb / 2.0
function Screen-Edge([double]$x, [double]$y) {
  $best = "bottom"; $bestD = [double]$h
  foreach ($pair in @(
    @{ n = "left"; d = $x },
    @{ n = "right"; d = ($w - $x) },
    @{ n = "top"; d = $y },
    @{ n = "bottom"; d = ($h - $y) }
  )) {
    if ($pair.d -lt $bestD -or ($pair.d -eq $bestD -and $pair.n -lt $best)) {
      $best = $pair.n; $bestD = $pair.d
    }
  }
  return $best
}
function Place-Panel($ox, $oy, $bw, $bh) {
  $edge = Screen-Edge $ox $oy
  $ax = $(if ($ox -gt ($w / 2.0)) { $bw - $orbR } else { $orbR })
  $header = "top"
  if ($edge -eq "bottom") { $header = "bottom" }
  elseif ($edge -ne "top") {
    $downTop = $oy - $orbR
    $upTop = $oy + $orbR - $bh
    $downOver = [Math]::Max(0, -$downTop) + [Math]::Max(0, ($downTop + $bh) - $h)
    $upOver = [Math]::Max(0, -$upTop) + [Math]::Max(0, ($upTop + $bh) - $h)
    if ($downOver -le 0.5) { $header = "top" }
    elseif ($upOver -lt ($downOver - 0.5)) { $header = "bottom" }
  }
  $ay = $(if ($header -eq "bottom") { $bh - $orbR } else { $orbR })
  return @{ left = $ox - $ax; top = $oy - $ay; w = $bw; h = $bh }
}
$settingsPanel = Place-Panel $settings.x $settings.y $settingsW $settingsH
$fieldPanel = Place-Panel $field.x $field.y 420 560
function Hits-Box($cand, $box) {
  return $cand.x -ge ($box.left - 16) -and $cand.x -lt ($box.left + $box.w + 16) -and $cand.y -ge ($box.top - 16) -and $cand.y -lt ($box.top + $box.h + 16)
}
$emptyCands = @(
  @{ x = 16; y = [int]($h / 2) },
  @{ x = 16; y = 16 },
  @{ x = [int]($w - 16); y = 16 }
)
$empty = $null
foreach ($cand in $emptyCands) {
  $onScreen = $cand.x -gt 0 -and $cand.y -gt 0 -and $cand.x -lt $w -and $cand.y -lt ($h - 48)
  if ($onScreen -and -not (Hits-Box $cand $settingsPanel) -and -not (Hits-Box $cand $fieldPanel)) {
    $empty = $cand
    break
  }
}
if (-not $empty) { throw "no blank point outside the settings and field panels" }
Write-Host "work insets L=$insetLeft T=$insetTop R=$insetRight B=$insetBottom settings $($settings.x),$($settings.y) kanban $($kanban.x),$($kanban.y) cron $($cron.x),$($cron.y)"
Write-Host "blank point $($empty.x),$($empty.y) outside settings $([int]$settingsPanel.left),$([int]$settingsPanel.top) $([int]$settingsPanel.w)x$([int]$settingsPanel.h) and field $([int]$fieldPanel.left),$([int]$fieldPanel.top) $([int]$fieldPanel.w)x$([int]$fieldPanel.h) field-orb $($field.x),$($field.y)"

$script:sampleNotes = New-Object System.Collections.Generic.List[string]

function Dump-Tree {
  try { [ClickProbe]::Dump($tree) } catch { "dump failed: $_" | Set-Content $tree }
}

function Click-Count { if (Test-Path $clickLog) { @(Get-Content $clickLog).Count } else { 0 } }

function Note-Ok([string]$label, [string]$extra) {
  $line = if ($extra) { "$label ok $extra" } else { "$label ok" }
  $script:sampleNotes.Add($line)
  Write-Host $line
  [Console]::Out.Flush()
}

function Note-Fail([string]$label, [string]$detail) {
  $line = "$label FAIL $detail"
  $script:sampleNotes.Add($line)
  Write-Host $line
  [Console]::Out.Flush()
}

function Assert-Empty([string]$label) {
  Assert-Through $label $empty.x $empty.y
}

function Read-HitRects {
  if (-not (Test-Path $log)) { return @() }
  $hits = Select-String -Path $log -Pattern "hit-rects " | Select-Object -Last 1
  if (-not $hits) { return @() }
  $found = @()
  foreach ($m in [regex]::Matches($hits.Line, '(?<id>\S+)@(?<x>-?\d+),(?<y>-?\d+),(?<w>-?\d+)x(?<h>-?\d+)')) {
    $found += @{
      id = $m.Groups['id'].Value
      x = [int]$m.Groups['x'].Value
      y = [int]$m.Groups['y'].Value
      w = [int]$m.Groups['w'].Value
      h = [int]$m.Groups['h'].Value
    }
  }
  return $found
}

function Wait-Log([string]$pattern, [int]$seconds = 10) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern $pattern -Quiet)) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Count-Log([string]$pattern) {
  if (-not (Test-Path $log)) { return 0 }
  return @(Select-String -Path $log -Pattern $pattern).Count
}

function Wait-Count([string]$pattern, [int]$before, [int]$seconds = 8) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if ((Count-Log $pattern) -gt $before) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Wait-PanelRect([string]$id, [int]$minH = 200, [int]$maxH = 4000) {
  $deadline = (Get-Date).AddSeconds(12)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    $rects = @(Read-HitRects)
    $hit = $rects | Where-Object { $_.id -eq $id -and $_.w -ge 40 } | Select-Object -First 1
    if ($hit) { $last = $hit }
    if ($hit -and $hit.h -ge $minH -and $hit.h -le $maxH) { return $hit }
    Start-Sleep -Milliseconds 200
  }
  return $last
}

function Point-Inside($p, $rect) {
  return $p.x -ge $rect.x -and $p.x -lt ($rect.x + $rect.w) -and $p.y -ge $rect.y -and $p.y -lt ($rect.y + $rect.h)
}

function Assert-Through([string]$label, [int]$x, [int]$y) {
  [ClickProbe]::Ctrl($false)
  [ClickProbe]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 250
  $hit = [ClickProbe]::HitAt($x, $y)
  $root = [ClickProbe]::GetAncestor($hit, 2)
  $cls = [ClickProbe]::ClassName($hit)
  $title = [ClickProbe]::Title($hit)
  if ($cls.StartsWith("Chrome_") -or ($root -ne $behindHwnd -and $hit -ne $behindHwnd)) {
    Dump-Tree
    Note-Fail $label "WindowFromPoint ($x,$y) class=$cls title=$title hwnd=$hit root=$root expected Behind $behindHwnd"
    return
  }
  $before = Click-Count
  [ClickProbe]::Click()
  $limit = (Get-Date).AddMilliseconds(500)
  do {
    if ((Click-Count) -gt $before) { break }
    Start-Sleep -Milliseconds 20
  } while ((Get-Date) -lt $limit)
  if ((Click-Count) -le $before) {
    Dump-Tree
    Note-Fail $label "SendInput at ($x,$y) did not reach Behind within 500ms class=$cls"
    return
  }
  Note-Ok $label "($x,$y) class=$cls"
}

# R-CT-05 / SPEC 1.7: while Ctrl is held every panel, its close button and the
# docked plan pass through; only orbs (and a pill under the cursor) capture.
# Ctrl is the "reach an orb under a panel" key, not a panel-click key.
function Assert-ThroughHeld([string]$label, [int]$x, [int]$y) {
  [ClickProbe]::SetCursorPos($x, $y) | Out-Null
  [ClickProbe]::Ctrl($true)
  try {
    Start-Sleep -Milliseconds 300
    $hit = [ClickProbe]::HitAt($x, $y)
    $root = [ClickProbe]::GetAncestor($hit, 2)
    $cls = [ClickProbe]::ClassName($hit)
    if ($cls.StartsWith("Chrome_") -or ($root -ne $behindHwnd -and $hit -ne $behindHwnd)) {
      Dump-Tree
      Note-Fail $label "Ctrl held: WindowFromPoint ($x,$y) class=$cls hwnd=$hit root=$root expected Behind $behindHwnd"
      return
    }
    $before = Click-Count
    [ClickProbe]::Click()
    $limit = (Get-Date).AddMilliseconds(500)
    do {
      if ((Click-Count) -gt $before) { break }
      Start-Sleep -Milliseconds 20
    } while ((Get-Date) -lt $limit)
    if ((Click-Count) -le $before) {
      Dump-Tree
      Note-Fail $label "Ctrl+click at ($x,$y) did not reach Behind within 500ms class=$cls"
      return
    }
    Note-Ok $label "($x,$y) class=$cls"
  } finally {
    [ClickProbe]::Ctrl($false)
    Start-Sleep -Milliseconds 300
  }
}

# R-CT-05 (Devon 2026-11-02): the docked plan is drawn at the panel's held
# opacity while Ctrl is held, and back at rest after. The app writes a
# debug-only plan-look line per open plan after each key edge with the drawn
# (computed) opacity: the plan's own when it is hosted outside the shell,
# the shell's when it is still inside it.
# `held` is the armed look: the first key-down edge can still be held=0 (the
# Ctrl→C lead, R-CT-06), so match the painted look, not only the key.
function Assert-PlanLook([string]$label, [string]$bot, [int]$down, [int]$before, [double]$lo, [double]$hi) {
  $pattern = "plan-look down=$down held=$down bot=$bot "
  if (-not (Wait-Count $pattern $before 4)) {
    Note-Fail $label "debug log has no new '$pattern' line"
    return
  }
  $line = @(Select-String -Path $log -Pattern $pattern)[-1].Line
  if ($line -notmatch "hosted=(\d) opacity=([0-9.]+)") {
    Note-Fail $label "unreadable plan-look line: $line"
    return
  }
  $hosted = $Matches[1]
  $drawn = [double]::Parse($Matches[2], [System.Globalization.CultureInfo]::InvariantCulture)
  if ($drawn -lt $lo -or $drawn -gt $hi) {
    Note-Fail $label "plan drawn at opacity $drawn hosted=$hosted, expected $lo..$hi"
    return
  }
  Note-Ok $label "opacity $drawn hosted=$hosted"
}

# A point inside the panel or plan that is clear of every orb's 12px hit pad
# (R-CT-02: Ctrl over an orb must reach the orb, even under a panel).
function Clear-OfOrbs($p, $orbs) {
  foreach ($o in $orbs) {
    if ($p.x -ge ($o.x - 24) -and $p.x -lt ($o.x + $o.w + 24) -and $p.y -ge ($o.y - 24) -and $p.y -lt ($o.y + $o.h + 24)) { return $false }
  }
  return $true
}

function Assert-OnScreen([string]$label, $rect) {
  if (-not $rect) {
    Note-Fail $label "rect missing"
    return
  }
  $right = $rect.x + $rect.w
  $bottom = $rect.y + $rect.h
  if ($rect.x -lt 0 -or $rect.y -lt 0 -or $right -gt $w -or $bottom -gt $h) {
    Note-Fail $label "rect $($rect.x),$($rect.y) $($rect.w)x$($rect.h) leaves ${w}x${h}"
    return
  }
  Note-Ok $label "$($rect.x),$($rect.y) $($rect.w)x$($rect.h) inside ${w}x${h}"
}

function Assert-Captured([string]$label, [int]$x, [int]$y) {
  [ClickProbe]::Ctrl($false)
  [ClickProbe]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 200
  $before = Click-Count
  [ClickProbe]::Click()
  Start-Sleep -Milliseconds 400
  if ((Click-Count) -gt $before) {
    Dump-Tree
    Note-Fail $label "click at ($x,$y) reached Behind"
    return
  }
  Note-Ok $label "($x,$y)"
}

# R-PN-09 (Devon 2026-11-10: no double arrow on the panel edge). The page
# logs where it painted each resize handle (resize-at, CSS px, debug log
# only). Screen px = CSS px x dpr. IDC_SIZENWSE 32642, IDC_SIZENESW 32643,
# IDC_SIZEWE 32644, IDC_SIZENS 32645.
function Read-ResizeAt([string]$id) {
  if (-not (Test-Path $log)) { return $null }
  $hit = Select-String -Path $log -Pattern "resize-at id=$id " | Select-Object -Last 1
  if (-not $hit) { return $null }
  $out = @{ dpr = 1.0; anchor = "start"; header = "top" }
  if ($hit.Line -match "dpr=([0-9.]+)") { $out.dpr = [double]::Parse($Matches[1], [System.Globalization.CultureInfo]::InvariantCulture) }
  if ($hit.Line -match "anchor=(start|end)") { $out.anchor = $Matches[1] }
  if ($hit.Line -match "header=(top|bottom)") { $out.header = $Matches[1] }
  foreach ($m in [regex]::Matches($hit.Line, ' (?<dir>xy|x|y)=(?<x>-?\d+),(?<y>-?\d+),(?<w>\d+)x(?<h>\d+)')) {
    $out[$m.Groups['dir'].Value] = @{
      x = [int]$m.Groups['x'].Value
      y = [int]$m.Groups['y'].Value
      w = [int]$m.Groups['w'].Value
      h = [int]$m.Groups['h'].Value
    }
  }
  return $out
}

function Resize-Point($box, [double]$dpr) {
  return @{
    x = [int][Math]::Round(($box.x + $box.w / 2) * $dpr)
    y = [int][Math]::Round(($box.y + $box.h / 2) * $dpr)
  }
}

# Hover the handle like a hand would: arrive, wait for the hit poll, then a
# 1px move (Windows asks for the cursor again only on a move). The sample
# before the move is logged so a missing refresh after the capture flip
# shows up as still=other.
function Assert-SizeCursor([string]$label, $p, [int]$want) {
  [ClickProbe]::Ctrl($false)
  # Park on the panel body first. WebView2 sometimes keeps the previous
  # SIZEWE cursor when the next sample is only a few pixels onto the grip.
  [ClickProbe]::SetCursorPos(400, 300) | Out-Null
  Start-Sleep -Milliseconds 150
  [ClickProbe]::SetCursorPos($p.x, $p.y) | Out-Null
  Start-Sleep -Milliseconds 300
  $expected = [ClickProbe]::SystemCursor($want)
  $still = [ClickProbe]::CursorId()
  $got = $still
  # The edge strip overlaps the grip. A single 1px nudge sometimes leaves the
  # previous SIZEWE cursor in place, so retry until WebView2 catches up.
  for ($try = 0; $try -lt 4; $try++) {
    [ClickProbe]::Nudge(1, 0)
    Start-Sleep -Milliseconds 80
    [ClickProbe]::Nudge(-1, 0)
    Start-Sleep -Milliseconds 180
    $got = [ClickProbe]::CursorId()
    if ($got -eq $expected) { break }
  }
  $stillText = if ($still -eq $expected) { "sizing" } else { "other" }
  if ($got -ne $expected) {
    $cls = [ClickProbe]::ClassName([ClickProbe]::HitAt($p.x, $p.y))
    Note-Fail $label "cursor $got at ($($p.x),$($p.y)) is not IDC $want ($expected); before the move it was $stillText ($still); after-nudge=$got; window under it class=$cls"
    return
  }
  Note-Ok $label "($($p.x),$($p.y)) IDC $want still=$stillText ($still) after-nudge=$got"
}

function Assert-Outside([string]$label, $rect) {
  $all = @(Read-HitRects)
  $points = @(
    @{ name = "left"; x = [int]$rect.x - 10; y = [int]($rect.y + $rect.h / 2) },
    @{ name = "right"; x = [int]($rect.x + $rect.w + 10); y = [int]($rect.y + $rect.h / 2) },
    @{ name = "top"; x = [int]($rect.x + $rect.w / 2); y = [int]$rect.y - 10 },
    @{ name = "bottom"; x = [int]($rect.x + $rect.w / 2); y = [int]($rect.y + $rect.h + 10) }
  )
  $checked = 0
  foreach ($p in $points) {
    if ($p.x -lt 2 -or $p.y -lt 2 -or $p.x -ge ($w - 2) -or $p.y -ge ($h - 48)) { continue }
    $inside = $false
    foreach ($other in $all) {
      if (Point-Inside $p $other) { $inside = $true; break }
    }
    if ($inside) { continue }
    # A rect published after the first read (the header × zone lands a beat
    # after the panel) is a real hit, not a click-through miss.
    [ClickProbe]::SetCursorPos($p.x, $p.y) | Out-Null
    Start-Sleep -Milliseconds 300
    $late = @(Read-HitRects | Where-Object { Point-Inside $p $_ } | Select-Object -First 1)
    if ($late) { continue }
    $checked++
    Assert-Through "$label-$($p.name)" $p.x $p.y
  }
  if ($checked -lt 1) {
    Note-Fail $label "no on-screen point 10px outside $($rect.id) $($rect.x),$($rect.y) $($rect.w)x$($rect.h)"
  }
}

function Read-PlanRect([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hits = Select-String -Path $log -Pattern "plan-rect bot=$bot open=1 " | Select-Object -Last 1
  if (-not $hits) { return $null }
  $m = [regex]::Match($hits.Line, 'x=(?<x>-?\d+) y=(?<y>-?\d+) w=(?<w>-?\d+) h=(?<h>-?\d+)')
  if (-not $m.Success) { return $null }
  return @{
    x = [int]$m.Groups['x'].Value
    y = [int]$m.Groups['y'].Value
    w = [int]$m.Groups['w'].Value
    h = [int]$m.Groups['h'].Value
  }
}

function Read-PlanClose([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hits = Select-String -Path $log -Pattern "plan-close-at bot=$bot " | Select-Object -Last 1
  if (-not $hits) { return $null }
  $m = [regex]::Match($hits.Line, 'x=(?<x>-?\d+) y=(?<y>-?\d+)')
  if (-not $m.Success) { return $null }
  return @{ x = [int]$m.Groups['x'].Value; y = [int]$m.Groups['y'].Value }
}

function Read-PanelCloseBox([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hits = Select-String -Path $log -Pattern "panel-close-at bot=$bot " | Select-Object -Last 1
  if (-not $hits) { return $null }
  $m = [regex]::Match($hits.Line, 'x=(?<x>-?\d+) y=(?<y>-?\d+) w=(?<w>-?\d+) h=(?<h>-?\d+)')
  if (-not $m.Success) { return $null }
  return @{
    x = [int]$m.Groups['x'].Value
    y = [int]$m.Groups['y'].Value
    w = [int]$m.Groups['w'].Value
    h = [int]$m.Groups['h'].Value
  }
}

function Wait-PanelCloseBox([string]$bot, [int]$seconds = 8) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $box = Read-PanelCloseBox $bot
    if ($box -and $box.w -ge 8 -and $box.h -ge 8) { return $box }
    Start-Sleep -Milliseconds 200
  }
  return $null
}

function Read-PlanChip([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hits = Select-String -Path $log -Pattern "plan-chip-at bot=$bot " | Select-Object -Last 1
  if (-not $hits) { return $null }
  $m = [regex]::Match($hits.Line, 'x=(?<x>-?\d+) y=(?<y>-?\d+)')
  if (-not $m.Success) { return $null }
  return @{ x = [int]$m.Groups['x'].Value; y = [int]$m.Groups['y'].Value }
}

function Read-LoggedButton {
  if (-not (Test-Path $log)) { return $null }
  $hits = Select-String -Path $log -Pattern "hit-close when=push .* button=(?<x>-?\d+),(?<y>-?\d+),(?<w>\d+)x(?<h>\d+)" | Select-Object -Last 1
  if (-not $hits) { return $null }
  $m = [regex]::Match($hits.Line, 'button=(?<x>-?\d+),(?<y>-?\d+),(?<w>\d+)x(?<h>\d+)')
  if (-not $m.Success) { return $null }
  return @{
    x = [int]$m.Groups['x'].Value
    y = [int]$m.Groups['y'].Value
    w = [int]$m.Groups['w'].Value
    h = [int]$m.Groups['h'].Value
  }
}

function Wait-IdGone([string]$id, [int]$seconds = 8) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $ids = @((Read-HitRects) | ForEach-Object { $_.id })
    if ($ids -notcontains $id) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

# A covered orb slides aside (R-OB-08). The home disc stays in the hit list
# so a click there is swallowed by the panel. Open the dodge spot instead.
function Dodge-Point([string]$id, $fallback) {
  if (Test-Path $log) {
    $hit = Select-String -Path $log -Pattern "orb-dodge id=$id to=" | Select-Object -Last 1
    if ($hit -and $hit.Line -match "to=(?<x>-?\d+(?:\.\d+)?),(?<y>-?\d+(?:\.\d+)?)") {
      return @{ x = [int][Math]::Round([double]$Matches.x); y = [int][Math]::Round([double]$Matches.y) }
    }
  }
  return $fallback
}

function Assert-Orb([string]$label, $orbPoint) {
  [ClickProbe]::SetCursorPos($orbPoint.x, $orbPoint.y) | Out-Null
  [ClickProbe]::Ctrl($true)
  Start-Sleep -Milliseconds 250
  $beforeOrb = Click-Count
  [ClickProbe]::Click()
  Start-Sleep -Milliseconds 500
  [ClickProbe]::Ctrl($false)
  if ((Click-Count) -gt $beforeOrb) {
    Dump-Tree
    Note-Fail $label "Ctrl+click on orb rect reached Behind"
    return
  }
  Note-Ok $label ""
}

function Read-PanelResized([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hit = Select-String -Path $log -Pattern "panel-resized bot=$bot .*from=" | Select-Object -Last 1
  if (-not $hit) { return $null }
  $m = [regex]::Match($hit.Line, 'from=(?<fw>\d+)x(?<fh>\d+) to=(?<tw>\d+)x(?<th>\d+)')
  if (-not $m.Success) { return $null }
  # box= is the shell box the app laid out after the drag (a sub-orb panel
  # re-cascades inside the work area, so its corner can move).
  $b = [regex]::Match($hit.Line, 'box=(?<x>-?\d+),(?<y>-?\d+),(?<w>\d+)x(?<h>\d+)')
  $laid = if ($b.Success) { @{ x = [int]$b.Groups['x'].Value; y = [int]$b.Groups['y'].Value; w = [int]$b.Groups['w'].Value; h = [int]$b.Groups['h'].Value } } else { $null }
  return @{
    fw = [int]$m.Groups['fw'].Value; fh = [int]$m.Groups['fh'].Value
    tw = [int]$m.Groups['tw'].Value; th = [int]$m.Groups['th'].Value
    box = $laid
  }
}

function Read-SavedPanelSize([string]$bot) {
  $path = Join-Path $configDir "config.json"
  if (-not (Test-Path $path)) { return $null }
  try { $cfg = Get-Content $path -Raw | ConvertFrom-Json } catch { return $null }
  if (-not $cfg.panel_sizes) { return $null }
  $size = $cfg.panel_sizes.$bot
  if (-not $size) { return $null }
  return @{ w = [int]$size.w; h = [int]$size.h }
}

function Grip-Point($handles) {
  $cx = if ($handles.anchor -eq "end") { $handles.xy.x + $handles.xy.w - 2 } else { $handles.xy.x + 1 }
  $cy = if ($handles.header -eq "bottom") { $handles.xy.y + $handles.xy.h - 2 } else { $handles.xy.y + 1 }
  return @{ x = [int][Math]::Round($cx * $handles.dpr); y = [int][Math]::Round($cy * $handles.dpr) }
}

# R-PN-09 grow (Devon 2026-11-16 「到而家都未可以拉大個框」). A real press on
# the free corner grip, 150px outward in 10px moves, then release. Before the
# fix the overlay went click-through as soon as the cursor left the frozen
# panel rect, so a grow stopped after a few px while a shrink worked. Checks:
# the panel grew, the size reached config.json panel_sizes through
# set_panel_size, the published rect grew, and a plain click in the strip the
# grow added stays in the overlay. A double-click on the moved grip then puts
# the design size back, so the checks after this one see the usual geometry.
function Assert-GrowDrag([string]$label, [string]$bot = "field", [string]$key = "") {
  if (-not $key) { $key = $bot }
  $id = "panel:$bot"
  $handles = $null
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    $handles = Read-ResizeAt $id
    if ($handles -and $handles.xy) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not ($handles -and $handles.xy)) {
    Note-Fail $label "debug log has no resize-at id=$id with an xy grip"
    return
  }
  $old = @(Read-HitRects | Where-Object { $_.id -eq $id } | Select-Object -First 1)
  if (-not $old) {
    Note-Fail $label "$id is not in the hit list before the drag"
    return
  }
  $old = $old[0]
  $sx = if ($handles.anchor -eq "end") { -1 } else { 1 }
  $sy = if ($handles.header -eq "bottom") { -1 } else { 1 }
  $grip = Grip-Point $handles
  $step = [Math]::Max(1, [int][Math]::Round(10 * $handles.dpr))
  $resizedBefore = Count-Log "panel-resized bot=$bot .*from="
  $behindBefore = Click-Count
  [ClickProbe]::Ctrl($false)
  [ClickProbe]::SetCursorPos($grip.x, $grip.y) | Out-Null
  Start-Sleep -Milliseconds 350
  [ClickProbe]::MoveTo($grip.x, $grip.y)
  Start-Sleep -Milliseconds 150
  [ClickProbe]::Down()
  try {
    Start-Sleep -Milliseconds 120
    for ($i = 1; $i -le 15; $i++) {
      [ClickProbe]::MoveTo($grip.x + $sx * $step * $i, $grip.y + $sy * $step * $i)
      Start-Sleep -Milliseconds 30
    }
    Start-Sleep -Milliseconds 200
  } finally {
    [ClickProbe]::Up()
  }
  Start-Sleep -Milliseconds 300
  if ((Click-Count) -gt $behindBefore) {
    Note-Fail $label "the press or release at the grip ($($grip.x),$($grip.y)) reached Behind"
  }
  if (-not (Wait-Count "panel-resized bot=$bot .*from=" $resizedBefore 4)) {
    Note-Fail $label "no panel-resized line after a 150px drag from ($($grip.x),$($grip.y)) sx=$sx sy=$sy"
    return
  }
  $size = Read-PanelResized $bot
  if (-not $size) {
    Note-Fail $label "unreadable panel-resized line"
    return
  }
  $dw = $size.tw - $size.fw
  $dh = $size.th - $size.fh
  if ($dw -lt 100 -or $dh -lt 0) {
    Note-Fail $label "panel went $($size.fw)x$($size.fh) -> $($size.tw)x$($size.th) (dw=$dw dh=$dh), expected at least +100 wide"
  } else {
    Note-Ok $label "$($size.fw)x$($size.fh) -> $($size.tw)x$($size.th)"
  }
  $saved = $null
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    $saved = Read-SavedPanelSize $key
    if ($saved -and $saved.w -eq $size.tw -and $saved.h -eq $size.th) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not ($saved -and $saved.w -eq $size.tw -and $saved.h -eq $size.th)) {
    $got = if ($saved) { "$($saved.w)x$($saved.h)" } else { "none" }
    Note-Fail "$label-saved" "config.json panel_sizes.$key is $got, expected $($size.tw)x$($size.th)"
  } else {
    Note-Ok "$label-saved" "panel_sizes.$key $($saved.w)x$($saved.h)"
  }
  # The panel box before and after, from the grip and the logged sizes. The
  # anchored sides stay put. An open plan can flip to the other side when the
  # grown panel leaves no room for it, so the published union need not widen
  # by the full drag; it must cover the whole grown panel box.
  if ($sx -gt 0) { $pl = $handles.xy.x + $handles.xy.w - $size.fw; $nl = $pl } else { $pl = $handles.xy.x; $nl = $pl + $size.fw - $size.tw }
  if ($sy -gt 0) { $pt = $handles.xy.y + $handles.xy.h - $size.fh; $nt = $pt } else { $pt = $handles.xy.y; $nt = $pt + $size.fh - $size.th }
  $box = @{ x = $nl; y = $nt; w = $size.tw; h = $size.th }
  if ($size.box -and $size.box.w -ge ($size.tw - 2) -and $size.box.h -ge ($size.th - 2)) {
    $box = $size.box
    $pl = if ($sx -gt 0) { $box.x } else { $box.x + $box.w - $size.fw }
  }
  $grown = $null
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    $grown = @(Read-HitRects | Where-Object {
      $_.id -eq $id -and -not ($_.x -le 0 -and $_.y -le 0 -and $_.w -ge ($w - 2) -and $_.h -ge ($h - 2)) -and
      $_.x -le ($box.x + 2) -and $_.y -le ($box.y + 2) -and
      ($_.x + $_.w) -ge ($box.x + $box.w - 2) -and ($_.y + $_.h) -ge ($box.y + $box.h - 2)
    } | Select-Object -First 1)
    if ($grown) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $grown) {
    $now = @(Read-HitRects | Where-Object { $_.id -eq $id } | Select-Object -First 1)
    $nowText = if ($now) { "$($now[0].x),$($now[0].y) $($now[0].w)x$($now[0].h)" } else { "missing" }
    Note-Fail "$label-hit" "$id is $nowText, does not cover the grown panel $($box.x),$($box.y) $($box.w)x$($box.h) (was $($old.x),$($old.y) $($old.w)x$($old.h))"
  } else {
    $grown = $grown[0]
    Note-Ok "$label-hit" "$id $($old.x),$($old.y) $($old.w)x$($old.h) -> $($grown.x),$($grown.y) $($grown.w)x$($grown.h) covers panel $($box.x),$($box.y) $($box.w)x$($box.h)"
    $orbs = @(Read-HitRects | Where-Object { $_.id -like "bot:*" })
    $half = [int][Math]::Floor(($size.tw - $size.fw) / 2)
    $nx = if ($sx -gt 0) { [int]($pl + $size.fw + $half) } else { [int]($pl - $half) }
    $probe = $null
    foreach ($f in @(0.5, 0.35, 0.65, 0.8)) {
      $cand = @{ x = [int][Math]::Round($nx * $handles.dpr); y = [int][Math]::Round(($box.y + $box.h * $f) * $handles.dpr) }
      if ($cand.x -lt 2 -or $cand.y -lt 2 -or $cand.x -ge ($w - 2) -or $cand.y -ge ($h - 48)) { continue }
      if (-not (Point-Inside $cand $grown)) { continue }
      if (-not (Clear-OfOrbs $cand $orbs)) { continue }
      $probe = $cand
      break
    }
    if (-not $probe) {
      Note-Fail "$label-new-area" "no point in the added strip clear of the orbs"
    } else {
      Assert-Captured "$label-new-area" $probe.x $probe.y
    }
  }
  # Put the design size back: double-click the grip where the grow left it.
  $moved = $null
  $deadline = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $deadline) {
    $moved = Read-ResizeAt $id
    if ($moved -and $moved.xy -and ([Math]::Abs($moved.xy.x - $handles.xy.x) -ge 50)) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not ($moved -and $moved.xy -and ([Math]::Abs($moved.xy.x - $handles.xy.x) -ge 50))) {
    Note-Fail "$label-reset" "resize-at for $id did not move with the grow"
    return
  }
  $resetBefore = Count-Log "panel-resized bot=$bot hit=\S* reset=1"
  $grip2 = Grip-Point $moved
  [ClickProbe]::SetCursorPos($grip2.x, $grip2.y) | Out-Null
  Start-Sleep -Milliseconds 350
  [ClickProbe]::Click()
  Start-Sleep -Milliseconds 60
  [ClickProbe]::Click()
  if (-not (Wait-Count "panel-resized bot=$bot hit=\S* reset=1" $resetBefore 4)) {
    Note-Fail "$label-reset" "double-click at ($($grip2.x),$($grip2.y)) did not reset the size"
    return
  }
  $deadline = (Get-Date).AddSeconds(5)
  $left = $true
  while ((Get-Date) -lt $deadline) {
    if (-not (Read-SavedPanelSize $key)) { $left = $false; break }
    Start-Sleep -Milliseconds 200
  }
  if ($left) {
    Note-Fail "$label-reset" "config.json still has panel_sizes.$key after the reset"
  } else {
    Note-Ok "$label-reset" "($($grip2.x),$($grip2.y))"
  }
  Start-Sleep -Milliseconds 500
}

# R-PL-09 (Devon 2026-11-17 17:03 London 「加拉闊邊，一齊做」). The plan
# logs its width handle (plan-resize-at, CSS px, debug log only): the outer
# 10px strip, away from the seam. side= is which side of the panel the plan
# sits on, room= the space left on that side.
function Read-PlanResizeAt([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hit = Select-String -Path $log -Pattern "plan-resize-at bot=$bot " | Select-Object -Last 1
  if (-not $hit) { return $null }
  $m = [regex]::Match($hit.Line, 'dpr=(?<dpr>[0-9.]+) side=(?<side>left|right) w=(?<pw>\d+) room=(?<room>\d+) at=(?<x>-?\d+),(?<y>-?\d+),(?<w>\d+)x(?<h>\d+)')
  if (-not $m.Success) { return $null }
  return @{
    dpr = [double]::Parse($m.Groups['dpr'].Value, [System.Globalization.CultureInfo]::InvariantCulture)
    side = $m.Groups['side'].Value
    pw = [int]$m.Groups['pw'].Value
    room = [int]$m.Groups['room'].Value
    x = [int]$m.Groups['x'].Value
    y = [int]$m.Groups['y'].Value
    w = [int]$m.Groups['w'].Value
    h = [int]$m.Groups['h'].Value
  }
}

function Read-PlanResized([string]$bot) {
  if (-not (Test-Path $log)) { return $null }
  $hit = Select-String -Path $log -Pattern "plan-resized bot=$bot .*from=" | Select-Object -Last 1
  if (-not $hit) { return $null }
  $m = [regex]::Match($hit.Line, 'from=(?<f>\d+) to=(?<t>\d+)')
  if (-not $m.Success) { return $null }
  return @{ from = [int]$m.Groups['f'].Value; to = [int]$m.Groups['t'].Value }
}

# A hosted plan clamped against the screen edge slides back beside its
# panel a frame after a release; the app logs the handle again then. Take the
# handle only once it shows width $pw on two reads 0.5s apart.
function Wait-PlanHandle([string]$bot, [int]$pw, [int]$seconds = 6) {
  $prev = ""
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $at = Read-PlanResizeAt $bot
    $now = if ($at -and $at.pw -eq $pw) { "$($at.x),$($at.y),$($at.w)x$($at.h)" } else { "" }
    if ($now -and $now -eq $prev) { return $at }
    $prev = $now
  }
  return $null
}

# One real press on the plan's width handle, $dx CSS px along x in 10 moves.
function Drag-PlanEdge($at, [int]$dx) {
  $px = [int][Math]::Round(($at.x + $at.w / 2) * $at.dpr)
  $py = [int][Math]::Round(($at.y + [Math]::Min(160, [Math]::Floor($at.h / 2))) * $at.dpr)
  $step = $dx * $at.dpr / 10.0
  [ClickProbe]::Ctrl($false)
  [ClickProbe]::SetCursorPos($px, $py) | Out-Null
  Start-Sleep -Milliseconds 350
  [ClickProbe]::MoveTo($px, $py)
  Start-Sleep -Milliseconds 150
  [ClickProbe]::Down()
  try {
    Start-Sleep -Milliseconds 120
    for ($i = 1; $i -le 10; $i++) {
      [ClickProbe]::MoveTo([int][Math]::Round($px + $step * $i), $py)
      Start-Sleep -Milliseconds 30
    }
    Start-Sleep -Milliseconds 200
  } finally {
    [ClickProbe]::Up()
  }
  Start-Sleep -Milliseconds 300
  return @{ x = $px; y = $py }
}

# Shrink the open plan 120px first so the grow has room on any runner, then
# widen it 100px outward. Checks: no press reached Behind, the width grew, it
# reached config.json panel_sizes._plan through set_panel_size, the published
# panel rect still covers the wider plan, and a plain click in the strip the
# grow added stays in the overlay. A double-click on the handle then puts the
# design width back (panel_sizes._plan removed) for the checks after this one.
function Assert-PlanWidthDrag([string]$label, [string]$bot = "field") {
  $at = $null
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline -and -not $at) {
    $at = Read-PlanResizeAt $bot
    if (-not $at) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $at) {
    Note-Fail $label "debug log has no plan-resize-at for $bot"
    return
  }
  Note-Ok "$label-handle" "side=$($at.side) w=$($at.pw) room=$($at.room) at=$($at.x),$($at.y),$($at.w)x$($at.h)"
  $out = if ($at.side -eq "left") { -1 } else { 1 }
  $behindBefore = Click-Count
  $shrinkBefore = Count-Log "plan-resized bot=$bot .*from="
  Drag-PlanEdge $at (-120 * $out) | Out-Null
  if (-not (Wait-Count "plan-resized bot=$bot .*from=" $shrinkBefore 4)) {
    Note-Fail $label "no plan-resized line after a 120px inward drag"
    return
  }
  $shrunk = Read-PlanResized $bot
  $at2 = Wait-PlanHandle $bot $(if ($shrunk) { $shrunk.to } else { -1 })
  if (-not ($at2 -and $shrunk)) {
    Note-Fail $label "plan-resize-at did not follow the shrink (to=$($shrunk.to))"
    return
  }
  $growBefore = Count-Log "plan-resized bot=$bot .*from="
  Drag-PlanEdge $at2 (100 * $out) | Out-Null
  if ((Click-Count) -gt $behindBefore) {
    Note-Fail $label "a press or release on the plan handle reached Behind"
  }
  if (-not (Wait-Count "plan-resized bot=$bot .*from=" $growBefore 4)) {
    Note-Fail $label "no plan-resized line after a 100px outward drag"
    return
  }
  $size = Read-PlanResized $bot
  $dw = $size.to - $size.from
  if ($dw -lt 60) {
    Note-Fail $label "plan went $($size.from) -> $($size.to) (dw=$dw), expected at least +60"
    return
  }
  Note-Ok $label "$($shrunk.from) -> $($shrunk.to) -> $($size.to)"
  $saved = $null
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    $saved = Read-SavedPanelSize "_plan"
    if ($saved -and $saved.w -eq $size.to) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not ($saved -and $saved.w -eq $size.to)) {
    $got = if ($saved) { "$($saved.w)" } else { "none" }
    Note-Fail "$label-saved" "config.json panel_sizes._plan.w is $got, expected $($size.to)"
  } else {
    Note-Ok "$label-saved" "panel_sizes._plan w=$($saved.w)"
  }
  $plan = $null
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    $plan = Read-PlanRect $bot
    if ($plan -and [Math]::Abs($plan.w - $size.to) -le 3) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not ($plan -and [Math]::Abs($plan.w - $size.to) -le 3)) {
    Note-Fail "$label-hit" "plan-rect never showed the wider plan ($($size.to))"
    return
  }
  $covered = $null
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    $covered = @(Read-HitRects | Where-Object {
      $_.id -eq "panel:$bot" -and -not ($_.x -le 0 -and $_.y -le 0 -and $_.w -ge ($w - 2) -and $_.h -ge ($h - 2)) -and
      $_.x -le ($plan.x + 2) -and ($_.x + $_.w) -ge ($plan.x + $plan.w - 2) -and
      $_.y -le ($plan.y + 2) -and ($_.y + $_.h) -ge ($plan.y + $plan.h - 2)
    } | Select-Object -First 1)
    if ($covered) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $covered) {
    $now = @(Read-HitRects | Where-Object { $_.id -eq "panel:$bot" } | Select-Object -First 1)
    $nowText = if ($now) { "$($now[0].x),$($now[0].y) $($now[0].w)x$($now[0].h)" } else { "missing" }
    Note-Fail "$label-hit" "panel:$bot is $nowText, does not cover the wider plan $($plan.x),$($plan.y) $($plan.w)x$($plan.h)"
  } else {
    $covered = $covered[0]
    Note-Ok "$label-hit" "panel:$bot $($covered.x),$($covered.y) $($covered.w)x$($covered.h) covers plan $($plan.x),$($plan.y) $($plan.w)x$($plan.h)"
    # A point in the strip the grow added, clear of the handle and the orbs.
    $orbs = @(Read-HitRects | Where-Object { $_.id -like "bot:*" })
    $nx = if ($out -gt 0) { $plan.x + $plan.w - 40 } else { $plan.x + 40 }
    $probe = $null
    foreach ($f in @(0.5, 0.35, 0.65, 0.8)) {
      $cand = @{ x = [int][Math]::Round($nx * $at.dpr); y = [int][Math]::Round(($plan.y + $plan.h * $f) * $at.dpr) }
      if ($cand.x -lt 2 -or $cand.y -lt 2 -or $cand.x -ge ($w - 2) -or $cand.y -ge ($h - 48)) { continue }
      if (-not (Clear-OfOrbs $cand $orbs)) { continue }
      $probe = $cand
      break
    }
    if (-not $probe) {
      Note-Ok "$label-new-area" "no point in the added strip clear of the orbs; skipped"
    } else {
      Assert-Captured "$label-new-area" $probe.x $probe.y
    }
  }
  # Put the design width back: double-click the handle where the grow left it.
  $at3 = Wait-PlanHandle $bot $size.to
  if (-not $at3) {
    Note-Fail "$label-reset" "no plan-resize-at after the grow"
    return
  }
  $rx = [int][Math]::Round(($at3.x + $at3.w / 2) * $at3.dpr)
  $ry = [int][Math]::Round(($at3.y + [Math]::Min(160, [Math]::Floor($at3.h / 2))) * $at3.dpr)
  $resetBefore = Count-Log "plan-resized bot=$bot .*reset=1"
  [ClickProbe]::SetCursorPos($rx, $ry) | Out-Null
  Start-Sleep -Milliseconds 350
  [ClickProbe]::Click()
  Start-Sleep -Milliseconds 60
  [ClickProbe]::Click()
  if (-not (Wait-Count "plan-resized bot=$bot .*reset=1" $resetBefore 4)) {
    Note-Fail "$label-reset" "double-click at ($rx,$ry) did not reset the plan width"
    return
  }
  $deadline = (Get-Date).AddSeconds(5)
  $left = $true
  while ((Get-Date) -lt $deadline) {
    if (-not (Read-SavedPanelSize "_plan")) { $left = $false; break }
    Start-Sleep -Milliseconds 200
  }
  if ($left) {
    Note-Fail "$label-reset" "config.json still has panel_sizes._plan after the reset"
  } else {
    Note-Ok "$label-reset" "($rx,$ry)"
  }
  Start-Sleep -Milliseconds 500
}

$overlay = $null
try {
  $env:HERMES_OVERLAY_DEBUG_LOG = $log
  $env:HERMES_HOME = $hermesHome
  # open_bot refuses a profile with no keyring entry, so the plan never loads.
  [ClickProbe]::StoreKey("profile:field.com.freezemusic.hermes-overlay", "profile:field", "clickthrough-key")
  $overlay = Start-Process -FilePath $exe.FullName -WorkingDirectory $root -PassThru
  $deadline = (Get-Date).AddSeconds(90)
  $revealed = $false
  while ((Get-Date) -lt $deadline) {
    if ($overlay.HasExited) { throw "overlay exited early: $($overlay.ExitCode)" }
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern "after-reveal" -Quiet)) {
      $revealed = $true
      break
    }
    Start-Sleep -Milliseconds 200
  }
  if (-not $revealed) {
    Dump-Tree
    throw "overlay did not reveal within 90s"
  }
  $revealedAt = Get-Date
  # First paint can land several seconds after after-reveal. Wait for an orb
  # hit rect before the click-through asserts, instead of a fixed 2s sleep.
  $paintDeadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $paintDeadline) {
    $painted = @(Read-HitRects | Where-Object { $_.id -eq "bot:settings" -and $_.w -gt 0 -and $_.h -gt 0 })
    if ($painted.Count -gt 0) { break }
    Start-Sleep -Milliseconds 200
  }
  Start-Sleep -Milliseconds 300
  # Settings is still closed. Empty space passes through, then Ctrl+click opens it.
  Assert-Empty "reveal+2s"
  # R-OB-05: 48px left of the settings disc is inside the 72px fade and
  # outside the 12px hit pad. Ctrl stays up, so the click reaches Behind.
  $settingsOrb = @(Read-HitRects | Where-Object { $_.id -eq "bot:settings" } | Select-Object -First 1)
  if (-not $settingsOrb) {
    Note-Fail "orb-proximity" "bot:settings missing from hit-rects"
  } else {
    $px = [int]($settingsOrb.x + $settingsOrb.w / 2 - 48)
    $py = [int]($settingsOrb.y + $settingsOrb.h / 2)
    Assert-Through "orb-proximity" $px $py
  }
  Assert-Orb "reveal+2s-settings" $settings
  $settingsRect = Wait-PanelRect "settings" 200 900
  if (-not $settingsRect) {
    Note-Fail "settings-opened" "hit-rects never published settings with height >= 200"
  } elseif ($settingsRect.h -gt 900) {
    Note-Fail "settings-opened" "hit rect $($settingsRect.x),$($settingsRect.y) $($settingsRect.w)x$($settingsRect.h) is taller than the card"
  } else {
    Note-Ok "settings-opened" "$($settingsRect.x),$($settingsRect.y) $($settingsRect.w)x$($settingsRect.h)"
    Assert-Outside "settings-edge" $settingsRect
  }
  # Settings is open. The blank point is outside that card.
  Assert-Empty "settings-open"
  # Close settings before the field panel. Two cards on a short runner stack
  # the bot to the 240px floor and the 睇計劃 chip lands on the composer.
  $button = Read-LoggedButton
  if (-not $button -or $button.w -lt 1) {
    Note-Fail "settings-closed" "debug log has no settings close button"
  } else {
    $bx = [int]($button.x + $button.w / 2)
    $by = [int]($button.y + $button.h / 2)
    Assert-Captured "settings-close" $bx $by
    $settingsGone = (Wait-IdGone "settings" 8) -and (Wait-IdGone "close:settings" 8)
    if (-not $settingsGone) {
      Note-Fail "settings-closed" "settings rect stayed in the hit list after ($bx,$by)"
    } else {
      Note-Ok "settings-closed" "$bx,$by"
      Start-Sleep -Milliseconds 400
    }
  }
  # Open the field bot panel. The gateway plan must come up before edge samples.
  Assert-Orb "bot-open" $field
  if (-not (Wait-Log "hit-announce bot=field mode=panel" 12)) {
    Note-Fail "bot-opened" "debug log has no hit-announce bot=field mode=panel"
  }
  $fieldRect = Wait-PanelRect "panel:field" 200 800
  if (-not $fieldRect) {
    Note-Fail "bot-opened" "hit-rects never published panel:field with height >= 200"
  } elseif ($fieldRect.h -gt 800) {
    Note-Fail "bot-opened" "hit rect $($fieldRect.x),$($fieldRect.y) $($fieldRect.w)x$($fieldRect.h) is taller than the card"
  } else {
    Note-Ok "bot-opened" "$($fieldRect.x),$($fieldRect.y) $($fieldRect.w)x$($fieldRect.h)"
    Assert-Outside "bot-edge" $fieldRect
  }
  # R-PL-01 (Devon 2026-11-17 17:03 London 「照建議修」): a plan already in
  # history never opens by itself, not on a panel open nor a restart. The
  # fake history is a /plan turn with a same-turn write_file, so the reply
  # carries 睇計劃; that click is the only way to open it.
  if (-not (Wait-Count "plan-chip-at bot=field " 0 12)) {
    Note-Fail "plan-chip" "debug log has no plan-chip-at for field (write_file plan not captured?)"
  } else {
    Start-Sleep -Seconds 2
    if ((Count-Log "plan-close-at bot=field ") -gt 0) {
      Note-Fail "plan-not-auto" "the history plan opened by itself"
    } else {
      Note-Ok "plan-not-auto" "history plan stayed shut"
    }
    $chip0 = Read-PlanChip "field"
    if ($chip0) { Assert-Captured "plan-chip-open" $chip0.x $chip0.y }
  }
  if (-not (Wait-Count "plan-close-at bot=field " 0 12)) {
    Note-Fail "plan-opened" "debug log has no plan-close-at for field"
  } else {
    # The 280ms grow (R-PL-04) and the hit host settle before the samples.
    Start-Sleep -Milliseconds 800
    $plan = Read-PlanRect "field"
    $closer = Read-PlanClose "field"
    if (-not $plan -or -not $closer) {
      Note-Fail "plan-opened" "plan rect or close point missing"
    } else {
      Note-Ok "plan-opened" "$($plan.x),$($plan.y) $($plan.w)x$($plan.h) close $($closer.x),$($closer.y)"
      Assert-OnScreen "plan-on-screen" $plan
      if ($closer.x -lt 0 -or $closer.y -lt 0 -or $closer.x -ge $w -or $closer.y -ge $h) {
        Note-Fail "plan-close-on-screen" "close $($closer.x),$($closer.y) leaves ${w}x${h}"
      } else {
        Note-Ok "plan-close-on-screen" "$($closer.x),$($closer.y)"
      }
      # Laptop look-test 2 Nov: Ctrl+click on the session picker and 關閉 of a
      # bot panel with its plan open went to the window behind. That is the
      # spec (R-CT-05): plain clicks operate panels, Ctrl+click passes through.
      # Pin both halves with the plan open: Ctrl passes through the panel body
      # and the plan, and a plain click on the same point of the panel hit rect
      # (panel:field covers the panel and its docked plan) is captured.
      $orbs = @(Read-HitRects | Where-Object { $_.id -like "bot:*" })
      $inPlan = @{ x = [int]($plan.x + $plan.w / 2); y = [int]($plan.y + $plan.h / 2) }
      $heldPoints = @(@{ name = "plan"; pt = $inPlan })
      $inPanel = $null
      if ($fieldRect) {
        $inPanel = @{ x = [int]($fieldRect.x + 48); y = [int]($fieldRect.y + [Math]::Min(240, [Math]::Max(24, $fieldRect.h - 80))) }
        $heldPoints = @(@{ name = "panel"; pt = $inPanel }) + $heldPoints
      }
      $heldChecked = 0
      foreach ($p in $heldPoints) {
        if (-not (Clear-OfOrbs $p.pt $orbs)) { continue }
        $heldChecked++
        $downBefore = Count-Log "plan-look down=1 held=1 bot=field "
        $upBefore = Count-Log "plan-look down=0 held=0 bot=field "
        Assert-ThroughHeld "ctrl-through-$($p.name)" $p.pt.x $p.pt.y
        if ($p.name -eq "plan") {
          # min_opacity 0.18 above, panel rest 1: held = min(0.18, 1).
          Assert-PlanLook "ctrl-plan-faded" "field" 1 $downBefore 0.0 0.20
          Assert-PlanLook "ctrl-plan-rest" "field" 0 $upBefore 0.98 1.0
        }
      }
      if ($heldChecked -lt 1) {
        Note-Fail "ctrl-through" "no panel or plan point clear of the orbs"
      }
      if ($inPanel -and (Clear-OfOrbs $inPanel $orbs)) {
        Assert-Captured "plain-click-panel-with-plan" $inPanel.x $inPanel.y
      }
      # R-PL-09: widen the plan from its outer edge; the height stays glued.
      Assert-PlanWidthDrag "plan-width" "field"
      $plan = Read-PlanRect "field"
      $closer = Read-PlanClose "field"
      # R-PN-09: the free edge and corner of the open field panel show the
      # Windows sizing cursor, a plain click there stays in the overlay, and
      # with Ctrl held the same point passes through (R-CT-05).
      $resizeDeadline = (Get-Date).AddSeconds(12)
      $handles = $null
      while ((Get-Date) -lt $resizeDeadline) {
        $handles = Read-ResizeAt "panel:field"
        if ($handles -and $handles.x -and $handles.xy) { break }
        Start-Sleep -Milliseconds 200
      }
      if (-not ($handles -and $handles.x -and $handles.xy)) {
        Note-Fail "resize-handles" "debug log has no resize-at id=panel:field with x and xy handles"
      } else {
        Note-Ok "resize-handles" "anchor=$($handles.anchor) header=$($handles.header) x=$($handles.x.x),$($handles.x.y),$($handles.x.w)x$($handles.x.h) dpr=$($handles.dpr)"
        $diag = if (($handles.anchor -eq "end") -xor ($handles.header -eq "bottom")) { 32643 } else { 32642 }
        $edgeMid = @{ x = $handles.x.x; y = $handles.x.y + [Math]::Floor($handles.x.h / 2); w = $handles.x.w; h = 1 }
        $edgePoint = Resize-Point $edgeMid $handles.dpr
        # The 12px grip overlaps both edge strips. Sample 1 CSS px in from the
        # inner corner so the hit is the grip, not the strip underneath it.
        $cx = if ($handles.anchor -eq "end") { $handles.xy.x + $handles.xy.w - 2 } else { $handles.xy.x + 1 }
        $cy = if ($handles.header -eq "bottom") { $handles.xy.y + $handles.xy.h - 2 } else { $handles.xy.y + 1 }
        $cornerPoint = @{
          x = [int][Math]::Round($cx * $handles.dpr)
          y = [int][Math]::Round($cy * $handles.dpr)
        }
        $checks = @(
          @{ name = "resize-cursor-x"; pt = $edgePoint; idc = 32644 },
          @{ name = "resize-cursor-corner"; pt = $cornerPoint; idc = $diag }
        )
        if ($handles.y) {
          $checks += @{ name = "resize-cursor-y"; pt = (Resize-Point $handles.y $handles.dpr); idc = 32645 }
        }
        $resizeChecked = 0
        foreach ($c in $checks) {
          if (-not (Clear-OfOrbs $c.pt $orbs)) { continue }
          $resizeChecked++
          Assert-SizeCursor $c.name $c.pt $c.idc
        }
        if ($resizeChecked -lt 1) {
          Note-Fail "resize-cursor" "no handle point clear of the orbs"
        } elseif (Clear-OfOrbs $edgePoint $orbs) {
          Assert-Captured "resize-plain-click" $edgePoint.x $edgePoint.y
          Assert-ThroughHeld "resize-ctrl-through" $edgePoint.x $edgePoint.y
        }
        # R-PN-09 grow with the plan open (the seam froze hits before the fix).
        Assert-GrowDrag "grow-with-plan" "field"
      }
      # Kanban's orb sits under the field panel on a 1024px runner.
      # Ctrl+click must reach that orb (R-CT-02), not the window behind.
      # The field plan seam keeps hit flushes deferred, so close:kanban is not
      # in the frozen announce. Click the centre of the measured 關閉 button.
      # seatKanbanClose moves that button clear of the plan's 預覽/原文 row.
      # Escape would close the focused field and take the plan with it.
      $kanbanOpened = $false
      for ($try = 0; $try -lt 3 -and -not $kanbanOpened; $try++) {
        Assert-Orb "ctrl-orb-under-panel" (Dodge-Point "kanban" $kanban)
        if (Wait-Log "hit-announce bot=kanban mode=panel" 3) { $kanbanOpened = $true }
      }
      if (-not $kanbanOpened) {
        Note-Fail "ctrl-orb-under-panel-opened" "kanban did not open under the field panel"
      } else {
        Note-Ok "ctrl-orb-under-panel-opened" ""
        [ClickProbe]::Ctrl($false)
        # R-KB-07 / R-AR-04 (todo 37): the kanban panel reads the dashboard
        # Kanban plugin (9119) through HermesClient, never the gateway proxy.
        $deadline = (Get-Date).AddSeconds(8)
        while (-not (Select-String -Path $dashLog -Pattern "^GET /api/plugins/kanban/board$" -Quiet) -and (Get-Date) -lt $deadline) {
          Start-Sleep -Milliseconds 200
        }
        if (-not (Select-String -Path $dashLog -Pattern "^GET /api/plugins/kanban/board$" -Quiet)) {
          Note-Fail "kanban-on-dashboard" "fake dashboard log has no GET /api/plugins/kanban/board"
        } elseif (Select-String -Path $gwLog -Pattern "/v1/overlay/kanban" -Quiet) {
          Note-Fail "kanban-on-dashboard" "the app called the gateway kanban proxy on 8642"
        } else {
          Note-Ok "kanban-on-dashboard" "board read on 9119, none on 8642"
        }
        $kanbanClose = Wait-PanelCloseBox "kanban" 8
        if (-not $kanbanClose) {
          Note-Fail "ctrl-orb-under-panel-closed" "kanban close button was not measured"
        } else {
          $kx = [int]($kanbanClose.x + $kanbanClose.w / 2)
          $ky = [int]($kanbanClose.y + $kanbanClose.h / 2)
          Assert-Captured "ctrl-orb-under-panel-close" $kx $ky
          $kanbanGone = Wait-IdGone "kanban" 8
          $fieldStill = @(Read-HitRects | Where-Object { $_.id -eq "panel:field" })
          if (-not $kanbanGone) {
            Note-Fail "ctrl-orb-under-panel-closed" "kanban rect stayed after its close button"
          } elseif ($fieldStill.Count -lt 1) {
            Note-Fail "ctrl-orb-under-panel-closed" "closing kanban dropped the field panel"
          } else {
            Note-Ok "ctrl-orb-under-panel-closed" ""
          }
        }
      }
      $drops = Count-Log "plan-hit-drop bot=field "
      Assert-Captured "plan-close" $closer.x $closer.y
      if (-not (Wait-Count "plan-hit-drop bot=field " $drops 8)) {
        Note-Fail "plan-closed" "x did not drop the plan hit rect"
      } else {
        $cx = [int]($plan.x + $plan.w / 2)
        $cy = [int]($plan.y + $plan.h / 2)
        Assert-Through "plan-former" $cx $cy
        Start-Sleep -Seconds 1
        Assert-Through "plan-former+1s" $cx $cy
        # The blank point is clear only while the plan is shut. 睇計劃
        # opens it to the left on this runner and covers (16,384) again.
        Assert-Empty "bot-panel-open"
        # R-PN-09 grow with no plan open.
        Assert-GrowDrag "grow-no-plan" "field"
        if (-not (Wait-Count "plan-chip-at bot=field " 0 8)) {
          Note-Fail "plan-reopen" "debug log has no plan-chip-at for field"
        } else {
          $chip = Read-PlanChip "field"
          $hosted = Count-Log "plan-close-at bot=field "
          if (-not $chip) {
            Note-Fail "plan-reopen" "plan chip point missing"
          } else {
            Assert-Captured "plan-reopen" $chip.x $chip.y
            if (-not (Wait-Count "plan-close-at bot=field " $hosted 10)) {
              Note-Fail "plan-reopen" "睇計劃 did not host the plan again"
            } else {
              Note-Ok "plan-reopen" "$($chip.x),$($chip.y)"
              $reopened = Read-PlanRect "field"
              if ($reopened) { Assert-OnScreen "plan-reopen-on-screen" $reopened }
            }
          }
        }
      }
    }
  }
  # R-CT-08 (Devon 2026-11-16 18:12 London 「跟 Desktop」): the composer is a
  # textarea. Shift+Enter is a new line and does not send; the field grows to
  # two lines (composer-fit lines=2) and no later fit shrinks it back (a send
  # clears it to one line). Backspace x3 leaves it empty for the steps below.
  $composerLine = Select-String -Path $log -Pattern "composer-at id=panel:field " -ErrorAction SilentlyContinue | Select-Object -Last 1
  if (-not $composerLine -or $composerLine.Line -notmatch "dpr=([0-9.]+) at=(-?\d+),(-?\d+),(\d+)x(\d+)") {
    Note-Fail "composer-newline" "no composer-at line for panel:field"
  } else {
    $cdpr = [double]::Parse($Matches[1], [System.Globalization.CultureInfo]::InvariantCulture)
    $cx = [int][Math]::Round(([int]$Matches[2] + [int]$Matches[4] / 2) * $cdpr)
    $cy = [int][Math]::Round(([int]$Matches[3] + [int]$Matches[5] / 2) * $cdpr)
    Assert-Captured "composer-click" $cx $cy
    Start-Sleep -Milliseconds 300
    $fitBefore = Count-Log "composer-fit id=field "
    $twoBefore = Count-Log "composer-fit id=field h=\d+ lines=2 "
    [ClickProbe]::Tap(0x41)
    Start-Sleep -Milliseconds 120
    [ClickProbe]::Key(0x10, $true)
    [ClickProbe]::Tap(0x0D)
    [ClickProbe]::Key(0x10, $false)
    Start-Sleep -Milliseconds 120
    [ClickProbe]::Tap(0x42)
    if (-not (Wait-Count "composer-fit id=field h=\d+ lines=2 " $twoBefore 5)) {
      Note-Fail "composer-newline" "Shift+Enter did not grow the composer to two lines (click $cx,$cy)"
    } else {
      Start-Sleep -Milliseconds 800
      $fits = @(Select-String -Path $log -Pattern "composer-fit id=field " | Select-Object -Skip $fitBefore)
      $shrunk = @($fits | Where-Object { $_.Line -match " lines=1 " })
      if ($shrunk.Count -gt 0) {
        Note-Fail "composer-newline" "composer went back to one line after Shift+Enter (sent?) $($shrunk[-1].Line)"
      } else {
        Note-Ok "composer-newline" "($cx,$cy) $($fits[-1].Line)"
      }
    }
    foreach ($n in 1..3) { [ClickProbe]::Tap(0x08); Start-Sleep -Milliseconds 60 }
    Start-Sleep -Milliseconds 300
  }
  # R-AT-01 (Devon 2026-11-17 10:18 London 「跟 Desktop 做，＋掣、拖放、貼圖」):
  # the ＋ left of the composer is clickable (not click-through), opens the
  # attach menu (attach-menu-open), the open menu lies inside a published hit
  # rect (attach:field, or panel:field while the plan seam defers flushes),
  # and Esc closes the menu first (attach-menu-close) while the panel stays.
  # No file dialog is opened on the runner.
  $attachLine = Select-String -Path $log -Pattern "attach-at id=panel:field " -ErrorAction SilentlyContinue | Select-Object -Last 1
  if (-not $attachLine -or $attachLine.Line -notmatch "dpr=([0-9.]+) at=(-?\d+),(-?\d+),(\d+)x(\d+)") {
    Note-Fail "attach-plus" "no attach-at line for panel:field"
  } else {
    $adpr = [double]::Parse($Matches[1], [System.Globalization.CultureInfo]::InvariantCulture)
    $ax = [int][Math]::Round(([int]$Matches[2] + [int]$Matches[4] / 2) * $adpr)
    $ay = [int][Math]::Round(([int]$Matches[3] + [int]$Matches[5] / 2) * $adpr)
    $openBefore = Count-Log "attach-menu-open id=field"
    $closeBefore = Count-Log "attach-menu-close id=field"
    Assert-Captured "attach-plus" $ax $ay
    if (-not (Wait-Count "attach-menu-open id=field" $openBefore 5)) {
      Note-Fail "attach-menu" "clicking the ＋ at ($ax,$ay) did not open the attach menu"
    } else {
      Start-Sleep -Milliseconds 400
      $openLine = Select-String -Path $log -Pattern "attach-menu-open id=field " | Select-Object -Last 1
      if (-not $openLine -or $openLine.Line -notmatch "at=(-?\d+),(-?\d+),(\d+)x(\d+)") {
        Note-Fail "attach-menu" "attach-menu-open has no box"
      } else {
        $mx = [int]$Matches[1]; $my = [int]$Matches[2]; $mw = [int]$Matches[3]; $mh = [int]$Matches[4]
        $menuHit = @(Read-HitRects | Where-Object {
          ($_.id -eq "attach:field" -or $_.id -eq "panel:field") -and
          $_.x -le ($mx + 1) -and $_.y -le ($my + 1) -and ($_.x + $_.w) -ge ($mx + $mw - 1) -and ($_.y + $_.h) -ge ($my + $mh - 1)
        })
        if ($menuHit.Count -lt 1) {
          Note-Fail "attach-menu" "open attach menu ($mx,$my ${mw}x$mh) is outside every published hit rect"
        } else {
          Note-Ok "attach-menu" "menu $mx,$my ${mw}x$mh inside $($menuHit[0].id)"
        }
      }
      [ClickProbe]::Tap(0x1B)
      if (-not (Wait-Count "attach-menu-close id=field" $closeBefore 5)) {
        Note-Fail "attach-menu-esc" "Esc did not close the attach menu"
      } else {
        Start-Sleep -Milliseconds 400
        $still = @(Read-HitRects | Where-Object { $_.id -eq "panel:field" })
        if ($still.Count -lt 1) { Note-Fail "attach-menu-esc" "Esc closed the panel instead of only the menu" }
        else { Note-Ok "attach-menu-esc" "menu closed, panel kept" }
      }
    }
  }
  $focus = @(Read-HitRects | Where-Object { $_.id -eq "panel:field" -or $_.id -eq "settings" } | Select-Object -First 1)
  if ($focus) {
    # 120px under a top field panel is the session <select>. pointerdown opens
    # the native menu, and both Escape taps are spent closing that menu, so
    # the panel stays on the hit list. The transcript is below that row and
    # above the composer. 睇計劃 on this runner sits near y=414, clear of 240px.
    $fx = [int]($focus.x + 48)
    $fromTop = 120
    if ($focus.id -eq "panel:field" -and $focus.h -ge 320) { $fromTop = 240 }
    $fy = [int]($focus.y + [Math]::Min($fromTop, [Math]::Max(24, $focus.h - 80)))
    Assert-Captured "escape-focus" $fx $fy
  }
  $beforeEscape = @(Read-HitRects | Where-Object { $_.id -notlike "close:*" -and $_.id -notlike "slash:*" -and $_.id -notlike "bot:*" -and $_.id -notlike "pill:*" -and $_.h -ge 80 })
  [ClickProbe]::Ctrl($false)
  [ClickProbe]::Tap(0x1B)
  $gone = $null
  $escapeAt = Get-Date
  $tappedAgain = $false
  $deadline = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $deadline -and -not $gone) {
    Start-Sleep -Milliseconds 200
    if (-not $tappedAgain -and ((Get-Date) - $escapeAt).TotalSeconds -gt 1.2) {
      # The first Escape closes the focused or topmost panel. A second tap is a no-op once that panel is gone.
      [ClickProbe]::Tap(0x1B)
      $tappedAgain = $true
    }
    $nowIds = @((Read-HitRects) | ForEach-Object { $_.id })
    foreach ($was in $beforeEscape) {
      if ($nowIds -notcontains $was.id) { $gone = $was; break }
    }
  }
  if (-not $gone) {
    Note-Fail "escape-closed" "no published panel rect left the hit list"
  } else {
    $gx = [int]($gone.x + $gone.w / 2)
    $gy = [int]($gone.y + $gone.h / 2)
    Note-Ok "escape-closed" "$($gone.id) $($gone.x),$($gone.y)"
    Assert-Through "escape-former" $gx $gy
  }
  Assert-Empty "after-escape"
  # R-PN-09 / R-SO-09 (Devon 2026-11-16 「你有確認子球框能拉嗎」): a sub-orb
  # session panel grows too. config.json pins side-task (an old fake row,
  # never the main session) as a sub-orb of field, so its disc is on the rail
  # once the field panel is shut. Every sub-orb panel shares panel_sizes._suborb.
  $subBot = "suborb:field:side-task"
  $subOrb = $null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not $subOrb) {
    $subOrb = @(Read-HitRects | Where-Object { $_.id -eq "bot:$subBot" -and $_.w -gt 0 } | Select-Object -First 1)
    if (-not $subOrb) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $subOrb) {
    $why = @(Select-String -Path $log -Pattern "suborb-(view|fan) |js-error|js-reject" | Select-Object -Last 8 | ForEach-Object { $_.Line -replace '^.*t=[0-9.]+ ', '' }) -join " | "
    Note-Fail "suborb-visible" "bot:$subBot never reached the hit list; last views: $why"
  } else {
    $subOrb = $subOrb[0]
    Note-Ok "suborb-visible" "$($subOrb.x),$($subOrb.y) $($subOrb.w)x$($subOrb.h)"
    $subPoint = @{ x = [int]($subOrb.x + $subOrb.w / 2); y = [int]($subOrb.y + $subOrb.h / 2) }
    $subPlanBefore = Count-Log "plan-close-at bot=$subBot "
    $subRect = $null
    for ($try = 0; $try -lt 3 -and -not $subRect; $try++) {
      Assert-Orb "suborb-open" $subPoint
      $subRect = Wait-PanelRect "panel:$subBot" 200 800
      if ($subRect -and $subRect.h -lt 200) { $subRect = $null }
    }
    if (-not $subRect) {
      Note-Fail "suborb-opened" "hit-rects never published panel:$subBot with height >= 200"
    } else {
      Note-Ok "suborb-opened" "$($subRect.x),$($subRect.y) $($subRect.w)x$($subRect.h)"
      # R-PL-01: the sub-orb's history plan stays shut too; 睇計劃 opens it.
      $subChipOpened = $false
      if (Wait-Count "plan-chip-at bot=$subBot " 0 10) {
        Start-Sleep -Seconds 1
        if ((Count-Log "plan-close-at bot=$subBot ") -gt $subPlanBefore) {
          Note-Fail "suborb-plan-not-auto" "the sub-orb history plan opened by itself"
        } else {
          Note-Ok "suborb-plan-not-auto" ""
        }
        $subChip = Read-PlanChip $subBot
        if ($subChip) {
          Assert-Captured "suborb-plan-chip-open" $subChip.x $subChip.y
          $subChipOpened = $true
        }
      }
      if ($subChipOpened -and (Wait-Count "plan-close-at bot=$subBot " $subPlanBefore 10)) {
        Note-Ok "suborb-plan-opened" ""
        Assert-GrowDrag "grow-suborb-with-plan" $subBot "_suborb"
        # The plan follows the re-cascaded box a beat after the reset (about
        # 2s on the runner). Read its × once it sits inside the published hit.
        $subCloser = $null
        $prev = ""
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline) {
          Start-Sleep -Milliseconds 700
          $subCloser = Read-PlanClose $subBot
          $subHit = @(Read-HitRects | Where-Object { $_.id -eq "panel:$subBot" } | Select-Object -First 1)
          $now = if ($subCloser -and $subHit) { "$($subCloser.x),$($subCloser.y) $($subHit[0].x),$($subHit[0].y),$($subHit[0].w)x$($subHit[0].h)" } else { "" }
          # Same × and same hit on two reads 0.7s apart, and the × inside it.
          if ($now -and $now -eq $prev -and (Point-Inside $subCloser $subHit[0])) { break }
          $prev = $now
        }
        $subDrops = Count-Log "plan-hit-drop bot=$subBot "
        if ($subCloser) {
          Assert-Captured "suborb-plan-close" $subCloser.x $subCloser.y
          if (-not (Wait-Count "plan-hit-drop bot=$subBot " $subDrops 8)) {
            Note-Fail "suborb-plan-closed" "x did not drop the sub-orb plan hit rect"
          } else {
            Note-Ok "suborb-plan-closed" "$($subCloser.x),$($subCloser.y)"
          }
        } else {
          Note-Fail "suborb-plan-closed" "no plan-close-at point for $subBot"
        }
      } else {
        Note-Ok "suborb-plan-opened" "no plan hosted on the sub-orb panel; plan case not run"
      }
      Assert-GrowDrag "grow-suborb-no-plan" $subBot "_suborb"
      # Shut the sub-orb panel: plain click in it for focus, then Escape.
      $subNow = @(Read-HitRects | Where-Object { $_.id -eq "panel:$subBot" } | Select-Object -First 1)
      if ($subNow) {
        $sfx = [int]($subNow[0].x + 48)
        $sfy = [int]($subNow[0].y + [Math]::Min(240, [Math]::Max(24, $subNow[0].h - 80)))
        [ClickProbe]::SetCursorPos($sfx, $sfy) | Out-Null
        Start-Sleep -Milliseconds 200
        [ClickProbe]::Click()
        Start-Sleep -Milliseconds 300
      }
      [ClickProbe]::Tap(0x1B)
      if (-not (Wait-IdGone "panel:$subBot" 6)) {
        [ClickProbe]::Tap(0x1B)
        if (-not (Wait-IdGone "panel:$subBot" 6)) {
          Note-Fail "suborb-closed" "panel:$subBot stayed after Escape"
        } else { Note-Ok "suborb-closed" "" }
      } else { Note-Ok "suborb-closed" "" }
      Start-Sleep -Milliseconds 600
    }
  }
  $remain = 32 - ((Get-Date) - $revealedAt).TotalSeconds
  if ($remain -gt 0) { Start-Sleep -Seconds $remain }
  Assert-Empty "reveal+32s"
  Assert-Orb "reveal+32s-cron" (Dodge-Point "cron" $cron)
  if ((Test-Path $gwLog) -and (Select-String -Path $gwLog -Pattern "POST /api/sessions" -Quiet)) {
    Note-Fail "gateway" "startup created a session"
  }
  # R-AR-04: zero requests to the old gateway (8642), not even GET /health.
  $gwHits = @()
  if (Test-Path $gwLog) { $gwHits = @(Get-Content $gwLog | Where-Object { $_ -ne "listening" }) }
  if ($gwHits.Count -gt 0) {
    Note-Fail "no-gateway-calls" ("8642 got " + $gwHits.Count + " request(s): " + (($gwHits | Select-Object -First 5) -join "; "))
  } else {
    Note-Ok "no-gateway-calls" "8642 fake saw no request"
  }
  # Same rule on 9119: opening a panel must not make a session (R-CL-07).
  if ((Test-Path $dashLog) -and (Select-String -Path $dashLog -Pattern "^(POST /api/sessions|RPC session\.create)" -Quiet)) {
    Note-Fail "dashboard" "startup created a session"
  }
  # The field history came from the dashboard, over REST and a live socket.
  foreach ($want in @("^POST /api/auth/ws-ticket", "^WS open", "^GET /api/sessions/[^/]+/messages")) {
    if (-not ((Test-Path $dashLog) -and (Select-String -Path $dashLog -Pattern $want -Quiet))) {
      Note-Fail "dashboard" "fake dashboard log has no $want"
    }
  }
  Write-Host "---- click-through samples ----"
  foreach ($line in $script:sampleNotes) { Write-Host $line }
  [Console]::Out.Flush()
  $failed = @($script:sampleNotes | Where-Object { $_ -match " FAIL " })
  if ($failed.Count -gt 0) {
    throw ($failed -join " || ")
  }
  Write-Host "click-through ok"
  [Console]::Out.Flush()
} catch {
  Dump-Tree
  Write-Host "click-through failed: $($_.Exception.Message)"
  [Console]::Out.Flush()
  throw
} finally {
  [ClickProbe]::Ctrl($false)
  if ($overlay -and -not $overlay.HasExited) { Stop-Process -Id $overlay.Id -Force -ErrorAction SilentlyContinue }
  if ($behind -and -not $behind.HasExited) { Stop-Process -Id $behind.Id -Force -ErrorAction SilentlyContinue }
  # GetContext blocks the runspace. Stop the listener from this scope first,
  # or $gw.Stop() waits until the 360-minute job timeout.
  $live = $shared.Listener
  if ($live) {
    try { $live.Stop() } catch {}
    try { $live.Close() } catch {}
  }
  if ($gw) {
    try { $gw.Stop() } catch {}
    $gw.Dispose()
  }
  if ($dashboard -and -not $dashboard.HasExited) { Stop-Process -Id $dashboard.Id -Force -ErrorAction SilentlyContinue }
  if (Test-Path $dashLog) { Copy-Item $dashLog (Join-Path $root "fake-dashboard.log") -Force }
  if (Test-Path $gwLog) { Copy-Item $gwLog (Join-Path $root "fake-gateway.log") -Force }
}
