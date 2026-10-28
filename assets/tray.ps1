param(
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$CmdFile,
  [string]$BaseUrl = 'http://127.0.0.1:7317',
  [string]$AppUrl = 'http://127.0.0.1:7317/',
  [string]$TipTitle = 'ikuyoMail'
)

# 托盘常驻进程：显示托盘图标、右下角气泡通知、右键菜单。
# Node 侧通过「写命令文件」下达指令（notify / title / quit），菜单动作直接调本地 HTTP 接口。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:stopping = $false

function Get-Json([string]$path) {
  try {
    return Invoke-RestMethod -Uri ($BaseUrl + $path) -TimeoutSec 6 -ErrorAction Stop
  } catch {
    return $null
  }
}

function Post-Json([string]$path, $body) {
  try {
    $json = if ($null -ne $body) { ($body | ConvertTo-Json -Compress -Depth 5) } else { '{}' }
    return Invoke-RestMethod -Uri ($BaseUrl + $path) -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 20 -ErrorAction Stop
  } catch {
    return $null
  }
}

function Open-Mailbox([string]$hash) {
  $url = $AppUrl
  if ($hash) { $url = $AppUrl + $hash }
  # 有原生窗口程序就优先用它（程序目录在 assets 的上一级）
  $appExe = Join-Path (Split-Path -Parent $PSScriptRoot) 'ikuyoMail.exe'
  if (Test-Path -LiteralPath $appExe) {
    if ($hash) {
      # 把去处（比如 settings）当参数交给 exe：窗口已开着时它会转达给那个窗口
      Start-Process -FilePath $appExe -ArgumentList @($hash.TrimStart('#'))
    } else {
      Start-Process -FilePath $appExe
    }
    return
  }
  $apps = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($exe in $apps) {
    if ($exe -and (Test-Path -LiteralPath $exe)) {
      # --app 打开的是没有地址栏的独立窗口，用起来更像个客户端
      Start-Process -FilePath $exe -ArgumentList @("--app=$url", '--window-size=1340,900')
      return
    }
  }
  Start-Process $url
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
try {
  $notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
} catch {
  $notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
}
$notifyIcon.Text = $TipTitle
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('打开 ikuyoMail')
$miCheck = $menu.Items.Add('立即检查新邮件')
$miMute = $menu.Items.Add('暂停新邮件提醒')
$null = $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miSettings = $menu.Items.Add('设置…')
$miQuit = $menu.Items.Add('退出')
$notifyIcon.ContextMenuStrip = $menu

$menu.add_Opening({
  $s = Get-Json '/api/settings'
  if ($s -and $s.settings) {
    if ($s.settings.notifyEnabled) { $miMute.Text = '暂停新邮件提醒' } else { $miMute.Text = '恢复新邮件提醒' }
  }
})

$miOpen.add_Click({ Open-Mailbox '' })
$notifyIcon.add_DoubleClick({ Open-Mailbox '' })
$notifyIcon.add_BalloonTipClicked({ Open-Mailbox '' })
$miSettings.add_Click({ Open-Mailbox '#settings' })

$miCheck.add_Click({
  $null = Post-Json '/api/check-now' $null
  $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $notifyIcon.BalloonTipTitle = '正在检查新邮件'
  $notifyIcon.BalloonTipText = '稍后有新邮件会提醒你。'
  $notifyIcon.ShowBalloonTip(2500)
})

$miMute.add_Click({
  $s = Get-Json '/api/settings'
  if ($s -and $s.settings) {
    $next = -not $s.settings.notifyEnabled
    try {
      $body = @{ notifyEnabled = $next }
      $json = $body | ConvertTo-Json -Compress
      $null = Invoke-RestMethod -Uri ($BaseUrl + '/api/settings') -Method Patch -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 6
      if ($next) { $notifyIcon.BalloonTipText = '新邮件提醒已恢复。' } else { $notifyIcon.BalloonTipText = '已暂停提醒，新邮件不再弹窗。' }
      $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::None
      $notifyIcon.BalloonTipTitle = 'ikuyoMail'
      $notifyIcon.ShowBalloonTip(2200)
    } catch { }
  }
})

$miQuit.add_Click({
  $script:stopping = $true
  $null = Post-Json '/api/power/quit' $null
  $notifyIcon.Visible = $false
  $notifyIcon.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

function Show-Balloon([string]$title, [string]$body, [bool]$sound) {
  if ([string]::IsNullOrWhiteSpace($title)) { $title = '新邮件' }
  if ($body.Length -gt 240) { $body = $body.Substring(0, 240) + '…' }
  $notifyIcon.BalloonTipTitle = $title
  $notifyIcon.BalloonTipText = $body
  if ($sound) {
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  } else {
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::None
  }
  $notifyIcon.ShowBalloonTip(6000)
}

function Set-Tip([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { $text = $TipTitle }
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $notifyIcon.Text = $text
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.add_Tick({
  if (-not (Test-Path -LiteralPath $CmdFile)) { return }
  $raw = $null
  try {
    $raw = [System.IO.File]::ReadAllText($CmdFile, [System.Text.Encoding]::UTF8)
    Remove-Item -LiteralPath $CmdFile -Force -ErrorAction SilentlyContinue
  } catch {
    return
  }
  if (-not $raw) { return }
  foreach ($line in ($raw -split "`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split "`t"
    switch ($parts[0]) {
      'notify' { Show-Balloon $parts[1] $parts[2] ($parts[3] -eq '1') }
      'title' { Set-Tip $parts[1] }
      'quit' { $miQuit.PerformClick() }
    }
  }
})
$timer.Start()

$notifyIcon.BalloonTipTitle = 'ikuyoMail 已在后台运行'
$notifyIcon.BalloonTipText = '关闭窗口不会退出，新邮件会在这里提醒。右键图标可退出。'
$notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::None
$notifyIcon.ShowBalloonTip(4000)

while (-not $script:stopping) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 100
}
