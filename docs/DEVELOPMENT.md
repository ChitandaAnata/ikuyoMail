# ikuyoMail 开发文档

面向想改代码或自己打包的人。使用上的问题请看主 [README](../README.md)。

## 从源码运行

```bash
cd mailbox
npm install
npm start
```

打开 **http://127.0.0.1:7317**。演示模式（假数据，不连服务器）：`npm run demo`（端口 7318）。

需要 Node.js 18 以上。服务只监听 `127.0.0.1`，局域网内其他设备访问不到。

### 两种外壳

- 双击 **`ikuyoMail.exe`**：原生窗口程序（C# WinForms + WebView2），自己拉起本地服务，关窗时按设置决定停不停服务。
- 双击 **`启动 ikuyoMail.bat`**：退回方案，用 Chrome / Edge 的 `--app` 窗口打开界面，由 `assets/shell.ps1` 驱动贴边抽屉。两条路的界面完全一样。

## 窗口、三栏与独立阅读窗口

### 三栏宽度

- 账号栏与列表之间、列表与阅读区之间各有一条分隔线，按住拖动即可改宽度；两侧都有最小宽度，不会被挤扁。
- 双击分隔线恢复默认宽度；用 Tab 把焦点移到分隔线上后，按 ← → 可以微调（按住 Shift 步长更大）。
- 拖过的宽度记在浏览器本地存储里，下次打开还是你调好的样子。
- 窗口变窄时列表和账号栏会临时让位给阅读区，但不会写入设置——窗口拉回去，宽度就回来了。
- 三块各有硬下限：**账号栏 190px、列表 340px、阅读区 440px**。列表的 340 是按「图标 + 主题 + 时间列 + 工具栏按钮」的实际需要量出来的；阅读区的 440 是按「正文左右各 22px 内边距 + 邮件里常见的两栏表格」量出来的。

### 窗口拉得很窄时会怎样

窗口变窄时按「账号栏 → 列表 → 阅读区」的顺序依次让位，谁先碰到自己的下限就停下，轮到下一块：

| 窗口宽度（账号栏 264、列表 384 时） | 谁在让位 |
|---|---|
| 1400 → 1100 | 只有阅读区在缩（它是弹性区，正文最宽） |
| 1100 → 1026 | 阅读区已到 440，开始缩账号栏 |
| 1026 → 982 | 账号栏已到 190，开始缩列表 |
| 982 以下 | 三块都到下限，**窗口再也缩不小了** |

- 三栏全展开时的最窄宽度 = 190 + 340 + 440 + 两条分隔线 = **982px**；收起阅读区后 = **536px**（加上窗口边框，外壳拦在 998 / 552）。
- 用 `ikuyoMail.exe` 启动时，窗口的最小尺寸是系统级的（`WM_GETMINMAXINFO`）：拖到边界就停住。从左边框或右边框拖都一样，固定另一侧边缘，窗口不会左右跳。
- 用 `启动 ikuyoMail.bat` 启动时，由 PowerShell 外壳向页面问这个值，同样会在下限处停住（先 `WM_CANCELMODE` 掐断拖动，再设回下限）。
- 直接用浏览器打开（不经外壳）没有这层保护：窗口窄过下限时页面底部会浮出提示条，并给一个「收起阅读区」按钮把下限降下来。

### 窗口拉得很矮时会怎样

高度下限等于当前最窄宽度的一半（三栏 499px，收起阅读区 276px，最低不低于 300px），这样工具栏、邮件列表、分页条不会被叠成两行。页面侧还有一个 44vw 的 `min-height` 兜底（只在 1200px 以下的窄窗口生效）；侧栏在很矮的时候会自己滚动，底部「设置」按钮仍然够得着。

### 独立阅读窗口

- 打开一封邮件后点「⧉ 独立窗口」，这封邮件在单独窗口里打开，主界面只剩账号栏和列表；关掉独立窗口自动恢复三栏，并回到最后看的那封。
- 主窗口里换着点别的邮件，独立窗口会跟着换。
- 弹窗期间主界面顶部有一条「收回到主界面」的提示。

### 贴边抽屉（仅 Windows）

浏览器页面搬不动系统窗口，这部分交给 `assets/shell.ps1`（bat 启动时）或 exe 的原生实现：

- `--app` 模式打开，用独立的浏览器 profile（`data/app-window-profile`）。
- 窗口默认贴在屏幕顶部。鼠标离开后向上滑，只留 3px；鼠标移到顶部边缘再滑出（进出同一缓动）。前台离开等 2.5 秒，后台 0.7 秒。
- 拖离顶部或最大化就不参与自动收起；从任务栏点回来会自动滑出。
- 正常位置记在 `data/shell-window.json`，异常退出会把窗口挪回屏幕内。
- 不想要抽屉效果：`powershell -ExecutionPolicy Bypass -File assets\shell.ps1 -NoEdgeHide`，或 `ikuyoMail.exe --no-edge-hide`。

## 打包成 exe

| | 双击 `ikuyoMail.exe` | 双击 `启动 ikuyoMail.bat` |
|---|---|---|
| 窗口 | 自己的 WinForms 窗口（WebView2 内核） | Chrome / Edge 的 `--app` 窗口 |
| 最小尺寸 | 系统级 `WM_GETMINMAXINFO` | PowerShell 轮询 + `WM_CANCELMODE` 掐断拖动 |
| 贴边抽屉 | 原生实现，30ms 检测 + 13 步缓动 | `assets/shell.ps1` 驱动 |
| 服务进程 | exe 自己拉起，关窗时按设置结束 | shell.ps1 负责 |
| 依赖 | .NET 10 桌面运行时 + WebView2 运行时（Win11 自带） | Node + 本机 Chrome/Edge |

- exe 需要和 `src`、`public`、`node_modules` 放在同一个文件夹里（它会往上找 `src/server.js`）。同目录的 `WebView2Loader.dll` 别删。
- exe 是单实例的：第二次启动不开新窗口，而是把参数（如 `settings`）转交已开着的窗口并叫到前台。
- 窗口大小和位置记在 `data/window.json`，WebView2 缓存在 `data/webview2`。

重新构建：

```bash
cd desktop
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o ../dist
cp ../dist/ikuyoMail.exe ../
```

（`-o` 不要直接指向项目根目录：SDK 会把 `obj` 里的中间产物一起算进去，报 CS5001。）

想要不依赖 .NET 运行时、可以拷给别人的版本，把 `--self-contained false` 换成 `true`（产物约 150MB）。

### 自检：另存为 PDF 的打印链路

「另存为 PDF」走 WebView2 的 `PrintToPdfAsync`，可以用命令行入口单独验证（不弹主窗口）：

```bash
ikuyoMail.exe --pdf-test="http://127.0.0.1:7317/print.html?acc=<账号id>&folder=INBOX&uid=<uid>|D:\out.pdf"
```

`ok=True` 且 `size` 不为 0 就说明链路是通的。

## 安装包构建与静默安装

生成（版本号在 `scripts/build-setup.mjs` 的 `VERSION` 与 `installer/Payload.cs` 的 `Version` 两处）：

```bash
node scripts/build-setup.mjs                   # 全量：发程序 → 收运行时 → 压包 → 发安装程序
SKIP_PAYLOAD=1 node scripts/build-setup.mjs    # 只改安装界面时用，跳过前三步
```

中间产物都在 `build/` 里：`build/app`（自包含 exe）、`build/payload`（要装进去的目录）、`installer/payload.zip`（嵌入资源）。

静默安装 / 卸载：

```bash
ikuyoMail-Setup-1.0.2.exe /S --dir=D://Apps --log=%TEMP%\setup.log   # 退出码 0 = 成功
Uninstall.exe                      # 带界面的卸载
Uninstall.exe /S                   # 静默卸载，保留 data
Uninstall.exe /S --purge           # 静默卸载，连账号数据一起删
```

安装界面可以单独出图核对（不装任何东西）：

```bash
ikuyoMail-Setup-1.0.2.exe --shot=shots/setup/ready.png
ikuyoMail-Setup-1.0.2.exe --shot=shots/setup/installing.png --step=installing
ikuyoMail-Setup-1.0.2.exe --path-test=H://          # 路径规整规则回显 → H://ikuyoMail
ikuyoMail.exe --uninstall-shot=shots/uninstall/confirm.png   # 卸载窗口状态图
```

## Gmail OAuth2 实现要点

- 凭据（Client ID + 加密 Secret）存 `data/google-auth.json`，每个账号的令牌单独存，`encrypt/decrypt` 基于 `data/.secret`（相对路径，跨目录解密会失败）。
- 授权回调走本机回环监听（`127.0.0.1` 随机端口，5 分钟超时）。
- 换令牌用 undici 按顺序重试出网通道：直连 → `HTTPS_PROXY` 环境变量 → Windows 注册表系统代理，成功后记住通道。
- SMTP 用 XOAUTH2（`imapflow` 的 `auth.accessToken` / nodemailer OAuth2），令牌过期前自动刷新。
- WebView2 的 `NewWindowRequested` 必须转交系统浏览器打开（OAuth 窗口不能在内嵌 WebView 里完成）。

## 搜索为什么不用 IMAP SEARCH

一开始搜索是直接发 `UID SEARCH OR SUBJECT/FROM/TO` 给服务器的，结果在网易 163 上永远返回 0 封——但服务器回的是 `OK`。抓包确认：Coremail 对 `FROM / SUBJECT / TO / TEXT` 一律回 `* SEARCH`（空列表）再回 OK，只有 `ALL` 和 UID 区间是准的。

所以改成**本地索引**：

1. 打开文件夹时后台按「新 → 旧」分批取回信封，缓存在内存里（每文件夹最多 5000 封）。
2. 搜索时本地做大小写不敏感的多关键词匹配（空格分隔，全部命中才算），中文、邮箱地址、发件人名字都能搜到。
3. 索引没建完也会先给已扫到的结果，列表顶部显示进度；后台抓取会让路给前台操作。
4. 新邮件、标已读、删除都会同步进索引。

## 邮件数量比网页版少？（163 / QQ 常见）

网易 163 用 Coremail，它在 **IMAP 会话建立的那一刻**对邮箱状态做快照。会话是在改「收取范围」之前建立的话，它会一直返回旧数字，无论网页端怎么改。全新连接立刻就能拿到正确数量（用 `scripts/diag-imap.js` 验证过）。

**正确操作顺序**：网页版改完「收取范围 = 全部邮件」→ 回客户端 → 点刷新（强制重新握手）。

程序的四层保护：

| 机制 | 说明 |
| --- | --- |
| 连接空闲 60 秒即断开 | 陈旧会话不长期驻留 |
| 连接绝对寿命 10 分钟 | 活跃使用也定期重建 |
| 刷新按钮强制重连 | 每次刷新都重新握手 |
| 诊断自动对比 | 旧会话与新连接各查一次，不一致就丢弃旧会话 |

## 目录结构

```
mailbox/
├── ikuyoMail.exe       原生窗口程序
├── WebView2Loader.dll  exe 的 WebView2 加载器，不能删
├── 启动 ikuyoMail.bat   没有 exe 时的退路
├── desktop/            WinForms + WebView2 外壳
│   ├── Program.cs        入口（--uninstall / --no-edge-hide / --pdf-test）
│   ├── MainForm.cs      窗口、最小尺寸、贴边抽屉、服务进程托管
│   ├── EmailPrinter.cs  另存为 PDF
│   └── Uninstaller.cs   卸载逻辑
├── installer/          自绘安装 / 卸载程序（C# WinForms）
│   ├── SetupForm.cs    安装界面：插画 + 安装位置 + 进度
│   ├── Payload.cs      解压、建快捷方式、写「应用和功能」条目
│   └── UninstallForm.cs 卸载窗口（确认 → 进度 → 完成）
├── src/
│   ├── server.js       Express 服务与 REST 接口、SSE 事件流
│   ├── imap.js         IMAP 连接池、收发信、文件夹与标志位操作
│   ├── goauth.js       Gmail OAuth2：凭据、授权回调、令牌刷新
│   ├── store.js        账号读写与 AES-256-GCM 加密
│   ├── marks.js        本地标记：置顶 / 待办 / 备注
│   ├── providers.js    服务商预设与自动识别
│   ├── proxy.js        账号级代理
│   ├── settings.js     全局设置读写
│   ├── poller.js       新邮件轮询：UID 水位线
│   ├── notifier.js     托盘进程管理与系统通知
│   ├── autostart.js    开机自启（启动文件夹里的 vbs）
│   └── demo.js         演示模式
├── public/             前端页面（index.html / app.js / styles.css / print.html）
├── assets/             shell.ps1（bat 外壳）、tray.ps1（托盘）、图标
├── scripts/            各类自测与验证脚本（e2e / 代理 / 布局 / 截图 / 打包）
└── data/               运行时生成（账号、密钥、设置，勿外传）
```

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/providers` | 服务商预设与登录指引 |
| GET/POST | `/api/accounts` | 列出 / 新增账号（新增时先验证 IMAP） |
| PATCH/DELETE | `/api/accounts/:id` | 修改 / 删除账号 |
| POST | `/api/accounts/:id/test` | 测试 IMAP 与 SMTP |
| GET | `/api/accounts/:id/diagnose` | 连接诊断（STATUS / EXISTS / SEARCH ALL） |
| GET | `/api/accounts/:id/folders` | 文件夹列表与未读数 |
| GET | `/api/accounts/:id/messages` | 邮件列表（`folder/page/pageSize/q`） |
| GET | `/api/accounts/:id/message` | 邮件详情 |
| GET | `/api/accounts/:id/attachment` | 下载附件 |
| POST | `/api/accounts/:id/flags` | 已读 / 星标 |
| DELETE | `/api/accounts/:id/message` | 删除邮件 |
| GET | `/api/accounts/:id/marks` | 本地标记表 |
| POST | `/api/accounts/:id/mark` | 改置顶 / 待办 / 备注 |
| POST | `/api/accounts/:id/send` | 发信 |
| GET | `/api/contacts` | 联系人自动补全 |
| GET/PATCH | `/api/settings` | 全局设置 |
| GET | `/api/events` | SSE 事件流：新邮件 `mail`、服务退出 `bye` |
| POST | `/api/heartbeat` | 页面心跳（带前台状态） |
| POST | `/api/check-now` | 立即检查新邮件 |
| POST | `/api/notify/test` | 发测试提醒 |
| POST | `/api/power/quit` | 退出程序 |
| GET | `/api/google/oauth/status` | Gmail OAuth 凭据与授权状态 |
| POST | `/api/google/oauth/config` | 保存 OAuth 客户端凭据 |
| POST | `/api/google/oauth/login` | 发起授权，返回本机回跳地址 |
| GET | `/api/google/oauth/login/:id` | 轮询授权进度 |
