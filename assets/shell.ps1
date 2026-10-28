<#
  ikuyoMail 桌面窗口外壳
  ---------------------------------------------------------------
  浏览器页面没法移动操作系统窗口，所以「贴到屏幕上边缘自动收起、
  鼠标移到边缘再滑出来」这套抽屉效果放在这个脚本里：它用 Win32 API
  直接搬动 Chrome / Edge 的应用窗口（--app 模式，没有地址栏）。

  工作方式：
    1. 先确认本地服务在跑，没有就用隐藏窗口拉起 node src/server.js
    2. 用 --app 打开客户端（独立的浏览器 profile，不和日常浏览混在一起）
    3. 每 35ms 看一次窗口位置和鼠标位置：
         · 窗口贴着屏幕顶部 且 鼠标离开窗口       → 向上滑，只留 3px 在屏幕上
         · 鼠标移到屏幕顶部那 3px 上               → 向下滑，回到原位
         · 用户把窗口拖离顶部 / 最大化窗口          → 不参与收起，正常使用
    4. 正常位置存在 data/shell-window.json，下次从原处打开

  用法：powershell -ExecutionPolicy Bypass -File assets\shell.ps1
        powershell ... -File assets\shell.ps1 -NoEdgeHide   # 只要独立窗口，不要抽屉效果
#>

param(
  [string]$Url = 'http://127.0.0.1:7317/',
  [int]$Port = 7317,
  [int]$Peek = 3,
  [int]$Width = 1380,
  [int]$Height = 880,
  [int]$SnapTop = 6,
  [int]$LeaveDelay = 700,
  # 窗口最小宽度：0 = 自动向页面询问（页面知道自己三块加起来最少要多少）
  [int]$MinWidth = 0,
  [switch]$NoEdgeHide,
  [switch]$Probe,
  [switch]$SelfTest,
  [int]$Seconds = 0
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $root 'data\shell.log'
$rectFile = Join-Path $root 'data\shell-window.json'

function Write-Log([string]$msg) {
  try {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch { }
}

try { Add-Type -AssemblyName System.Windows.Forms } catch { }

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class ShellWin {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wp, IntPtr lp);

    /// 左键是否按着（用户正在拖边框）
    public static bool LeftDown() { return (GetAsyncKeyState(0x01) & 0x8000) != 0; }

    /// 结束系统正在进行的「拖动窗口」模态循环：手还没松，窗口也已经停在你放手前的位置
    public static void CancelDrag(IntPtr hWnd) { SendMessage(hWnd, 0x001F /* WM_CANCELMODE */, IntPtr.Zero, IntPtr.Zero); }
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsProcessDPIAware();
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    public const uint NO_ZORDER = 0x0004;
    public const uint NO_ACTIVATE = 0x0010;

    public static bool Move(IntPtr hWnd, int x, int y, int w, int h) {
        return SetWindowPos(hWnd, IntPtr.Zero, x, y, w, h, NO_ZORDER | NO_ACTIVATE);
    }

    /// 按标题精确查找浏览器应用窗口（--app 模式下标题就是页面 title）
    public static IntPtr FindAppWindow(string title) {
        IntPtr exact = IntPtr.Zero;
        IntPtr loose = IntPtr.Zero;
        EnumWindows(delegate(IntPtr h, IntPtr p) {
            if (!IsWindowVisible(h)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowTextW(h, sb, 512);
            string text = sb.ToString();
            if (text.Length == 0) return true;
            StringBuilder cls = new StringBuilder(256);
            GetClassNameW(h, cls, 256);
            string klass = cls.ToString();
            if (klass != "Chrome_WidgetWin_1" && klass != "Chrome_WidgetWin_0") return true;
            if (string.Equals(text, title, StringComparison.OrdinalIgnoreCase)) {
                if (exact == IntPtr.Zero) exact = h;
            } else if (loose == IntPtr.Zero && text.IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0) {
                loose = h;
            }
            return true;
        }, IntPtr.Zero);
        if (exact != IntPtr.Zero) return exact;
        return loose;
    }
}
'@

function Test-Service {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(350)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch { }
  }
}

function Get-WindowRect([IntPtr]$hWnd) {
  $r = New-Object ShellWin+RECT
  [void][ShellWin]::GetWindowRect($hWnd, [ref]$r)
  return $r
}

function Get-CursorPoint {
  $p = New-Object ShellWin+POINT
  [void][ShellWin]::GetCursorPos([ref]$p)
  return $p
}

# 自检：只验证 API 能不能用，不动任何窗口
if ($Probe) {
  $probeRect = New-Object ShellWin+RECT
  $probePoint = New-Object ShellWin+POINT
  [void][ShellWin]::GetCursorPos([ref]$probePoint)
  $probeWa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  'Add-Type OK'
  "光标位置: $($probePoint.X), $($probePoint.Y)"
  "工作区: $($probeWa.X),$($probeWa.Y) $($probeWa.Width)x$($probeWa.Height)"
  "ikuyoMail 窗口句柄: $([ShellWin]::FindAppWindow('ikuyoMail'))"
  "服务在跑: $(Test-Service)"
  $probeHwnd = [ShellWin]::FindAppWindow('ikuyoMail')
  if ($probeHwnd -ne [IntPtr]::Zero) {
    [void][ShellWin]::GetWindowRect($probeHwnd, [ref]$probeRect)
    $pw = $probeRect.Right - $probeRect.Left
    $ph = $probeRect.Bottom - $probeRect.Top
    "窗口位置: $($probeRect.Left),$($probeRect.Top) ${pw}x${ph}"
    $ok1 = [ShellWin]::Move($probeHwnd, $probeRect.Left + 40, $probeRect.Top + 40, $pw, $ph)
    Start-Sleep -Milliseconds 300
    $r2 = Get-WindowRect $probeHwnd
    "移动 +40,+40 -> $($r2.Left),$($r2.Top) 返回=$ok1"
    [void][ShellWin]::Move($probeHwnd, $probeRect.Left, $probeRect.Top, $pw, $ph)
    Start-Sleep -Milliseconds 300
    $r3 = Get-WindowRect $probeHwnd
    "移回 -> $($r3.Left),$($r3.Top)"
  }
  exit 0
}


# ---------------------------------------------------------------- 1. 服务

# 只留一个外壳进程：双击多次时，把已有窗口叫到前面就行
$pidFile = Join-Path $root 'data\shell.pid'
if (Test-Path -LiteralPath $pidFile) {
  $oldPid = (Get-Content -LiteralPath $pidFile -Raw) -replace '\D', ''
  if ($oldPid) {
    $alive = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
    if ($alive) {
      $running = [ShellWin]::FindAppWindow('ikuyoMail')
      if ($running -ne [IntPtr]::Zero) { [void][ShellWin]::SetForegroundWindow($running) }
      Write-Log "已有外壳在跑（pid=$oldPid），把窗口叫到前面"
      exit 0
    }
  }
}
try { Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII } catch { }

if (-not (Test-Service)) {
  Write-Log '本地服务没在跑，先启动 node src/server.js'
  Start-Process -FilePath 'node' -ArgumentList 'src\server.js' -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Service) { break }
  }
  if (-not (Test-Service)) { Write-Log '服务启动失败，退出'; exit 1 }
}

# ---------------------------------------------------------------- 2. 浏览器窗口

$title = 'ikuyoMail'
$hWnd = [ShellWin]::FindAppWindow($title)

if ($hWnd -eq [IntPtr]::Zero) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
  )
  $browser = $null
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { $browser = $c; break }
  }
  if (-not $browser) {
    Write-Log '没找到 Chrome / Edge，退回默认浏览器打开（贴边效果不可用）'
    Start-Process $Url
    exit 0
  }

  $profileDir = Join-Path $root 'data\app-window-profile'
  if (-not (Test-Path -LiteralPath $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }

  $browserArgs = @(
    "--app=$Url",
    "--user-data-dir=`"$profileDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    "--window-size=$Width,$Height",
    '--disable-features=Translate,ChromeWhatsNewUI'
  )
  Write-Log "启动应用窗口：$browser"
  Start-Process -FilePath $browser -ArgumentList $browserArgs

  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 250
    $hWnd = [ShellWin]::FindAppWindow($title)
    if ($hWnd -ne [IntPtr]::Zero) { break }
  }
}

if ($hWnd -eq [IntPtr]::Zero) {
  Write-Log '没等到应用窗口，退出'
  exit 1
}

# ---------------------------------------------------------------- 3. 摆到合适位置

Start-Sleep -Milliseconds 600
$wa = $null
try { $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea } catch { }
if (-not $wa) { $wa = New-Object System.Drawing.Rectangle 0, 0, 1920, 1040 }

$saved = $null
if (Test-Path -LiteralPath $rectFile) {
  try { $saved = Get-Content -LiteralPath $rectFile -Raw | ConvertFrom-Json } catch { }
}

$baseX = [int]($wa.X + ($wa.Width - $Width) / 2)
$baseY = [int]$wa.Y
$baseW = $Width
$baseH = $Height

if ($saved -and $saved.w -gt 400 -and $saved.h -gt 300) {
  # 只接受还在屏幕内的位置，防止上次异常退出把窗口留在屏幕外
  $onScreen = $saved.x -ge ($wa.X - 40) -and $saved.x -lt ($wa.X + $wa.Width - 200) -and
              $saved.y -ge ($wa.Y - 10) -and $saved.y -lt ($wa.Y + $wa.Height - 150)
  if ($onScreen) {
    $baseX = [int]$saved.x
    $baseY = [int]$saved.y
    $baseW = [int]$saved.w
    $baseH = [int]$saved.h
  }
}

[void][ShellWin]::Move($hWnd, $baseX, $baseY, $baseW, $baseH)
Start-Sleep -Milliseconds 250

function Save-Rect([int]$x, [int]$y, [int]$w, [int]$h) {
  try {
    $obj = [ordered]@{ x = $x; y = $y; w = $w; h = $h }
    ($obj | ConvertTo-Json -Compress) | Set-Content -LiteralPath $rectFile -Encoding UTF8
  } catch { }
}

function Slide([IntPtr]$hWnd, [int]$fromY, [int]$toY, [int]$x, [int]$w, [int]$h, [int]$steps = 13) {
  for ($i = 1; $i -le $steps; $i++) {
    $t = $i / $steps
    $ease = 1 - [Math]::Pow(1 - $t, 3)          # easeOutCubic，收尾轻
    $y = [int][Math]::Round($fromY + ($toY - $fromY) * $ease)
    [void][ShellWin]::Move($hWnd, $x, $y, $w, $h)
    Start-Sleep -Milliseconds 15
  }
}

# ---------------------------------------------------------------- 4. 主循环

# 任何一次异常（窗口句柄失效、取不到矩形……）都不该让整个外壳退出：
# 循环体整体包在 try/catch 里，出错就记一笔继续盯下一个 35ms。
trap {
  try {
    $ln = $_.InvocationInfo.ScriptLineNumber
    $txt = $_.InvocationInfo.Line.Trim()
    Write-Log "脚本异常（第 $ln 行）：$($_.Exception.Message) | $txt"
  } catch { }
  Start-Sleep -Milliseconds 200
  continue
}

$probeStart = Get-CursorPoint
$st1 = $false; $st2 = $false; $st3 = $false; $st4 = $false
$state = 'expanded'     # expanded | hidden
$hideAt = $null
$startAt = Get-Date
$entered = $false       # 鼠标进过窗口吗（防止一启动就自己收起来）
$leaveSince = $null
$lastSave = [datetime]::MinValue   # 必须是 DateTime：写成 0 会让 Get-Date - $lastSave 重载歧义
# 这次拖动开始时的四边位置（用来判断拖的是哪一条边，钳制时好固定对边）
$dragLeft = $null
$dragRight = $null
$dragTop = $null
$dragBottom = $null
$minWidth = 998          # 页面加载前先按「三栏全展开 + 边框」兜底（190+340+12+440+16）
$lastMinPoll = Get-Date
$lastClamp = Get-Date

# 页面报的是 CSS 像素；如果本进程是 DPI 感知的，SetWindowPos 要的是物理像素，得换算
$dpiScale = 1.0
try {
  if ([ShellWin]::IsProcessDPIAware()) {
    $dpi = [ShellWin]::GetDpiForWindow($hWnd)
    if ($dpi -ge 96) { $dpiScale = [double]$dpi / 96.0 }
  }
} catch { }
if ([Math]::Abs($dpiScale - 1.0) -gt 0.01) { Write-Log "DPI 缩放：$dpiScale" }

Write-Log "进入监视：hWnd=$hWnd 位置=$baseX,$baseY 尺寸=${baseW}x${baseH}"

try {
  while ($true) {
   try {
    if ($SelfTest) {
      $elapsed = ((Get-Date) - $startAt).TotalSeconds
      if (-not $st1 -and $elapsed -gt 1) { [void][ShellWin]::SetCursorPos($baseX + 200, $baseY + 200); $st1 = $true; Write-Log "自检：鼠标进入窗口 $($baseX + 200),$($baseY + 200)" }
      elseif ($st1 -and -not $st2 -and $elapsed -gt 2) { [void][ShellWin]::SetCursorPos($baseX + 200, $baseY + $baseH + 160); $st2 = $true; Write-Log "自检：鼠标离开窗口 $($baseX + 200),$($baseY + $baseH + 160)" }
      elseif ($st2 -and -not $st3 -and $state -eq 'hidden') { $st3 = $true; Write-Log "自检：已收起 top=$((Get-WindowRect $hWnd).Top)" }
      elseif ($st3 -and -not $st4 -and $elapsed -gt 5) { [void][ShellWin]::SetCursorPos($baseX + 200, 1); $st4 = $true; Write-Log "自检：鼠标移到屏幕顶边 $($baseX + 200),1" }
      elseif ($st4 -and $state -eq 'expanded') { Write-Log "自检：已弹出 top=$((Get-WindowRect $hWnd).Top)"; [void][ShellWin]::SetCursorPos($probeStart.X, $probeStart.Y); exit 0 }
    }
    if ($Seconds -gt 0 -and ((Get-Date) - $startAt).TotalSeconds -ge $Seconds) { Write-Log "自检时长到（$Seconds 秒），退出"; break }
    if (-not [ShellWin]::IsWindowVisible($hWnd)) {
      # 窗口被关掉了：等它重新出现，等不到就退出
      $hWnd = [ShellWin]::FindAppWindow($title)
      if ($hWnd -eq [IntPtr]::Zero) {
        Start-Sleep -Milliseconds 500
        $hWnd = [ShellWin]::FindAppWindow($title)
        if ($hWnd -eq [IntPtr]::Zero) { Write-Log '窗口已关闭，退出'; break }
        [void][ShellWin]::Move($hWnd, $baseX, $baseY, $baseW, $baseH)
        $state = 'expanded'
      }
    }

    $r = Get-WindowRect $hWnd
    if ($r -is [array]) { $r = $r[0] }   # 偶尔会被管道多吐一个对象，取第一个就好
    $p = Get-CursorPoint
    if ($p -is [array]) { $p = $p[0] }
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    $maximized = [ShellWin]::IsZoomed($hWnd)

    # 记下这次拖动刚开始时的四边位置，钳制时好判断拖的是哪一条边
    if ([ShellWin]::LeftDown()) {
      if ($null -eq $dragLeft) {
        $dragLeft = $r.Left; $dragRight = $r.Right
        $dragTop = $r.Top; $dragBottom = $r.Bottom
      }
    } else {
      $dragLeft = $null; $dragRight = $null; $dragTop = $null; $dragBottom = $null
    }

    # 每 1 秒问一次页面「现在最少要多少像素」：三栏全展开 902，收起阅读区 536
    if ($MinWidth -le 0 -and ((Get-Date) - $lastMinPoll).TotalMilliseconds -gt 1000) {
      $lastMinPoll = Get-Date
      try {
        $wc = New-Object System.Net.WebClient
        $wc.Proxy = $null
        $json = $wc.DownloadString("http://127.0.0.1:$Port/api/ui/min-width")
        $resp = $json | ConvertFrom-Json
        $wc.Dispose()
        if ($resp -and $resp.width -ge 300) {
          $autoMin = [int]$resp.width
          if ($autoMin -ne $minWidth) { Write-Log "页面最小宽度：$autoMin"; $minWidth = $autoMin }
        }
      } catch { Write-Log "读最小宽度失败：$($_.Exception.Message)" }
    }

    # 不能被拖得比最小宽度还窄（再窄右边内容就跑到视口外面了），
    # 也不能比最小宽度的一半还矮（上下挤扁之后三栏里的按钮就开始换行、叠字）。
    # 手还按着（正在拖）就先取消这次拖动，让窗口当场停在下限，而不是松手后才弹回来
    $limit = if ($MinWidth -gt 0) { $MinWidth } else { $minWidth }
    $limitPx = [int][Math]::Ceiling($limit * $dpiScale)
    $minHPx = [int][Math]::Ceiling(($limit / 2) * $dpiScale)
    $tooNarrow = $limitPx -gt 0 -and $w -lt ($limitPx - 2)
    $tooShort = $minHPx -gt 0 -and $h -lt ($minHPx - 2)
    if (-not $maximized -and ($tooNarrow -or $tooShort) -and
        ((Get-Date) - $lastClamp).TotalMilliseconds -gt 80) {
      $lastClamp = Get-Date
      if ([ShellWin]::LeftDown()) { [void][ShellWin]::CancelDrag($hWnd) }
      $nw = if ($tooNarrow) { $limitPx } else { $w }
      $nh = if ($tooShort) { $minHPx } else { $h }
      $nx = $r.Left
      # 从左边框往右拖窄的：右边保持不动，免得右边缘往右跳出去
      if ($tooNarrow -and $null -ne $dragLeft -and $r.Left -gt ($dragLeft + 1) -and
          [Math]::Abs($r.Right - $dragRight) -le 1) {
        $nx = $r.Right - $nw
      }
      $ny = $r.Top
      # 从下边框往上拖矮的：上边缘保持不动
      if ($tooShort -and $null -ne $dragTop -and $r.Top -gt ($dragTop + 1) -and
          [Math]::Abs($r.Bottom - $dragBottom) -le 1) {
        $ny = $r.Bottom - $nh
      }
      if ($tooNarrow) {
        if ($nx + $nw -gt ($wa.X + $wa.Width)) { $nx = [Math]::Max($wa.X, $wa.X + $wa.Width - $nw) }
        if ($nx -lt $wa.X) { $nx = $wa.X }
      }
      if ($tooShort) {
        if ($ny + $nh -gt ($wa.Y + $wa.Height)) { $ny = [Math]::Max($wa.Y, $wa.Y + $wa.Height - $nh) }
        if ($ny -lt $wa.Y) { $ny = $wa.Y }
      }
      [void][ShellWin]::Move($hWnd, $nx, $ny, $nw, $nh)
      $baseX = $nx; $baseY = $ny; $baseW = $nw; $baseH = $nh
      $r = Get-WindowRect $hWnd
      if ($r -is [array]) { $r = $r[0] }
      $w = $r.Right - $r.Left
      $h = $r.Bottom - $r.Top
    }

    if ($state -eq 'hidden') {
      # 鼠标到屏幕上边缘那条 3px → 滑出来
      $hot = ($p.Y -le $Peek) -and ($p.Y -ge 0) -and ($p.X -ge $r.Left) -and ($p.X -le $r.Right)
      # 从任务栏点回来时窗口在屏幕外，也要还原
      $backFront = ($hideAt) -and (((Get-Date) - $hideAt).TotalMilliseconds -gt 800) -and ([ShellWin]::GetForegroundWindow() -eq $hWnd)
      if ($hot -or $backFront) {
        Slide $hWnd $r.Top 0 $r.Left $w $h
        $state = 'expanded'
        $entered = $true
        $leaveSince = $null
      }
      Start-Sleep -Milliseconds 35
      continue
    }

    # ---- expanded ----
    $inside = ($p.X -ge $r.Left) -and ($p.X -le $r.Right) -and ($p.Y -ge $r.Top) -and ($p.Y -le $r.Bottom)
    $foreground = ([ShellWin]::GetForegroundWindow() -eq $hWnd)
    if ($inside) {
      $entered = $true
      $leaveSince = $null
    } elseif ($entered -and -not $leaveSince) {
      $leaveSince = Get-Date
    }
    # 点过窗口就算「用过」，之后鼠标移开也照常收起
    if ($foreground) { $entered = $true }

    # 用户手动挪动 / 缩放窗口 → 记住新位置
    if (-not $inside -and ([Math]::Abs($r.Left - $baseX) -gt 2 -or [Math]::Abs($r.Top - $baseY) -gt 2 -or
        [Math]::Abs($w - $baseW) -gt 2 -or [Math]::Abs($h - $baseH) -gt 2)) {
      $baseX = $r.Left; $baseY = $r.Top; $baseW = $w; $baseH = $h
      if (((Get-Date) - $lastSave).TotalSeconds -gt 2) {
        Save-Rect $baseX $baseY $baseW $baseH
        $lastSave = Get-Date
      }
    }

    $docked = (-not $NoEdgeHide) -and (-not $maximized) -and ($r.Top -le $SnapTop)
    $warmup = (((Get-Date) - $startAt).TotalSeconds -gt 2.5)
    # 窗口在前台时多留一会儿（免得刚抬手鼠标就滑走了），后台窗口则很快收起
    $idleLimit = $LeaveDelay
    if ($foreground) { $idleLimit = [Math]::Max($LeaveDelay * 4, 2500) }
    $idle = $leaveSince -and $warmup -and (((Get-Date) - $leaveSince).TotalMilliseconds -ge $idleLimit)

    if ($docked -and $entered -and $idle) {
      # 收成屏幕顶部一条边
      Save-Rect $r.Left $r.Top $w $h
      $target = $Peek - $h
      Slide $hWnd $r.Top $target $r.Left $w $h
      $state = 'hidden'
      $leaveSince = $null
      $hideAt = Get-Date
      Write-Log ("收起：{0},{1} {2}x{3} -> top={4}" -f $r.Left, $r.Top, $w, $h, $target)
    }

    Start-Sleep -Milliseconds 35
   } catch {
    try {
      $ln = $_.InvocationInfo.ScriptLineNumber
      $txt = $_.InvocationInfo.Line.Trim()
      Write-Log "循环异常（第 $ln 行）：$($_.Exception.Message) | $txt"
    } catch { }
    Start-Sleep -Milliseconds 200
   }
  }
} finally {
  # 无论怎么退出，都把窗口挪回屏幕里，别让它卡在外面
  $r = Get-WindowRect $hWnd
  if ($r.Top -lt 0) {
    [void][ShellWin]::Move($hWnd, $baseX, [int]$wa.Y, $baseW, $baseH)
  }
  Write-Log '外壳退出'
  try { Remove-Item -LiteralPath $pidFile -Force } catch { }
}
