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
  param($shared, $gwLog)
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
      if ($path -like "/api/sessions*") {
        $body = '{"data":[{"id":"bot-chat","title":"Bot Chat","source":"api_server","last_active":40},{"id":"saved-field","title":"notes","source":"api_server","last_active":10},{"id":"newest","title":"System Architect","source":"api_server","last_active":900}]}'
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
$gw.AddScript($gwScript).AddArgument($shared).AddArgument($gwLog) | Out-Null
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
$cron = @{ x = [int]($w - $pad - $orb / 2); y = [int][Math]::Round($h * 0.38) }
# reveal+2s Ctrl+clicks the settings orb, which opens a panel of
# min(680, 92vw) by min(86vh, 760) anchored on that orb. On a 1024x768
# runner that panel covers (200, h/2), so the +32s blank sample was hitting
# the WebView. The blank point stays beside the panel (R-CT-01).
$settingsW = [Math]::Min(680.0, $w * 0.92)
$settingsH = [Math]::Min($h * 0.86, 760.0)
$orbR = $orb / 2.0
$panelLeft = $settings.x - ($settingsW - $orbR)
$panelTop = $settings.y - ($settingsH - $orbR)
$emptyCands = @(
  @{ x = 16; y = [int]($h / 2) },
  @{ x = 16; y = 16 },
  @{ x = [int]($w - 16); y = 16 }
)
$empty = $null
foreach ($cand in $emptyCands) {
  $onPanel = $cand.x -ge ($panelLeft - 16) -and $cand.x -lt ($panelLeft + $settingsW + 16) -and $cand.y -ge ($panelTop - 16) -and $cand.y -lt ($panelTop + $settingsH + 16)
  $onScreen = $cand.x -gt 0 -and $cand.y -gt 0 -and $cand.x -lt $w -and $cand.y -lt ($h - 48)
  if (-not $onPanel -and $onScreen) { $empty = $cand; break }
}
if (-not $empty) { throw "no blank point beside the settings panel" }
Write-Host "blank point $($empty.x),$($empty.y) beside settings $([int]$panelLeft),$([int]$panelTop) $([int]$settingsW)x$([int]$settingsH)"

function Dump-Tree {
  try { [ClickProbe]::Dump($tree) } catch { "dump failed: $_" | Set-Content $tree }
}

function Click-Count { if (Test-Path $clickLog) { @(Get-Content $clickLog).Count } else { 0 } }

function Assert-Sample([string]$label, $orbPoint) {
  [ClickProbe]::Ctrl($false)
  [ClickProbe]::SetCursorPos($empty.x, $empty.y) | Out-Null
  Start-Sleep -Milliseconds 250
  $hit = [ClickProbe]::HitAt($empty.x, $empty.y)
  $root = [ClickProbe]::GetAncestor($hit, 2)
  $cls = [ClickProbe]::ClassName($hit)
  $title = [ClickProbe]::Title($hit)
  if ($cls.StartsWith("Chrome_") -or ($root -ne $behindHwnd -and $hit -ne $behindHwnd)) {
    Dump-Tree
    throw "$label WindowFromPoint class=$cls title=$title hwnd=$hit root=$root expected Behind $behindHwnd"
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
    throw "$label SendInput at empty point did not reach Behind within 500ms"
  }
  [ClickProbe]::SetCursorPos($orbPoint.x, $orbPoint.y) | Out-Null
  [ClickProbe]::Ctrl($true)
  Start-Sleep -Milliseconds 250
  $beforeOrb = Click-Count
  [ClickProbe]::Click()
  Start-Sleep -Milliseconds 500
  [ClickProbe]::Ctrl($false)
  if ((Click-Count) -gt $beforeOrb) {
    Dump-Tree
    throw "$label Ctrl+click on orb rect reached Behind"
  }
  Write-Host "$label ok class=$cls"
  [Console]::Out.Flush()
}

$overlay = $null
try {
  $env:HERMES_OVERLAY_DEBUG_LOG = $log
  $env:HERMES_HOME = $hermesHome
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
  Start-Sleep -Seconds 2
  Assert-Sample "reveal+2s" $settings
  Start-Sleep -Seconds 30
  Assert-Sample "reveal+32s" $cron
  if ((Test-Path $gwLog) -and (Select-String -Path $gwLog -Pattern "POST /api/sessions" -Quiet)) {
    throw "startup created a session: $(Get-Content $gwLog -Raw)"
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
