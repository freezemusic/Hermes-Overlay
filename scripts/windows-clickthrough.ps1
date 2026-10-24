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
foreach ($path in @($log, $tree, $clickLog, $hwndFile, $gwLog)) {
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
[System.IO.File]::WriteAllText((Join-Path $configDir "config.json"), @'
{
  "version": 1,
  "gateway_base_url": "http://127.0.0.1:8642",
  "dashboard_base_url": "http://127.0.0.1:9119",
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
  public static void Ctrl(bool down) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.u.ki.wVk = 0x11;
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
$w = $bounds.Width
$h = $bounds.Height
$pad = 42
$orb = 44
$settings = @{ x = [int]($w - $pad - 152 - $orb / 2); y = [int]($h - $pad - $orb / 2) }
$kanban = @{ x = [int]($w / 2); y = [int]($pad + $orb / 2) }
$cron = @{ x = [int]($w - $pad - $orb / 2); y = [int][Math]::Round($h * 0.38) }
# One field bot uses the first distributeEdges slot. That slot does not
# depend on the bot count, and it stays clear of kanban, cron, and settings.
# On 1024x768 it is the right edge, not the old top-edge t=0.21.
# Its open panel is 420x560 anchored on that orb. Settings is
# min(680, 92vw) by min(86vh, 760), anchored on the settings orb.
# The blank point has to miss both of those rects. On 1024x768,
# (200, h/2) is inside settings, so it is not a pass-through sample.
function Slot-Point([string]$edge, [double]$t) {
  $x0 = $w * 0.08
  $y0 = $h * 0.08
  $spanX = $w * 0.84
  $spanY = $h * 0.84
  if ($edge -eq "top") { return @{ x = ($x0 + $spanX * $t); y = ($pad + $orb / 2.0) } }
  if ($edge -eq "bottom") { return @{ x = ($x0 + $spanX * $t); y = ($h - $pad - $orb / 2.0) } }
  if ($edge -eq "left") { return @{ x = ($pad + $orb / 2.0); y = ($y0 + $spanY * $t) } }
  return @{ x = ($w - $pad - $orb / 2.0); y = ($y0 + $spanY * $t) }
}
function Point-Dist($a, $b) {
  $dx = [double]$a.x - [double]$b.x
  $dy = [double]$a.y - [double]$b.y
  return [Math]::Sqrt(($dx * $dx) + ($dy * $dy))
}
$chromeGap = $orb + 8
$slotSpan = [Math]::Max(1.0, [Math]::Min([double]$w, [double]$h) * 0.84)
$step = [Math]::Min(0.18, [Math]::Max(0.07, ($chromeGap + 4) / $slotSpan))
$fieldPoint = $null
for ($t = $step; -not $fieldPoint -and $t -le (1 - $step * 0.5 + 0.000001); $t += $step) {
  $rounded = [Math]::Round($t * 1000) / 1000
  foreach ($edge in @("right", "bottom", "left", "top")) {
    $cand = Slot-Point $edge $rounded
    $blocked = $false
    foreach ($chrome in @($kanban, $cron, $settings)) {
      if ((Point-Dist $cand $chrome) -le $chromeGap) { $blocked = $true; break }
    }
    if (-not $blocked) { $fieldPoint = $cand; break }
  }
}
if (-not $fieldPoint) { throw "no field slot clear of kanban, cron, and settings" }
$field = @{ x = [int][Math]::Round($fieldPoint.x); y = [int][Math]::Round($fieldPoint.y) }
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
  Start-Sleep -Seconds 2
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
  if (-not (Wait-Count "plan-close-at bot=field " 0 12)) {
    Note-Fail "plan-opened" "debug log has no plan-close-at for field"
  } else {
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
      # Ctrl+click must reach the kanban orb while the field panel is open
      # (R-CT-02), not the window behind.
      # The field plan seam keeps hit flushes deferred, so close:kanban is not
      # in the frozen announce. Click the centre of the measured 關閉 button.
      # seatKanbanClose moves that button clear of the plan's 預覽/原文 row.
      # Escape would close the focused field and take the plan with it.
      Assert-Orb "ctrl-orb-under-panel" $kanban
      if (-not (Wait-Log "hit-announce bot=kanban mode=panel" 8)) {
        Note-Fail "ctrl-orb-under-panel-opened" "kanban did not open under the field panel"
      } else {
        Note-Ok "ctrl-orb-under-panel-opened" ""
        [ClickProbe]::Ctrl($false)
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
  $remain = 32 - ((Get-Date) - $revealedAt).TotalSeconds
  if ($remain -gt 0) { Start-Sleep -Seconds $remain }
  Assert-Empty "reveal+32s"
  Assert-Orb "reveal+32s-cron" $cron
  if ((Test-Path $gwLog) -and (Select-String -Path $gwLog -Pattern "POST /api/sessions" -Quiet)) {
    Note-Fail "gateway" "startup created a session"
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
}
