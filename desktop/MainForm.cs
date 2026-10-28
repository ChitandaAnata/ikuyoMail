using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ikuyoMail;

/// <summary>
/// 原生窗口外壳：内嵌 WebView2 显示 ikuyoMail 的界面，负责启动/关闭本地服务，
/// 并用自己的窗口最小尺寸限制代替浏览器里那套「拖到下限再弹回」的补丁。
/// </summary>
public sealed class MainForm : Form
{
    /// <summary>首选端口；被别的程序占着（或别人占着但不是这一份）就往后找</summary>
    private const int FirstPort = 7317;
    private const int LastPort = 7327;

    /// <summary>三栏全展开时的最窄宽度（含窗口边框），其余值由页面报上来</summary>
    private const int DefaultMinWidth = 998;
    private const string Title = "ikuyoMail";

    // 一定不要走系统代理：本机 127.0.0.1 的请求被代理接管的话，会认不出自己刚拉起的服务
    private static readonly HttpClient Http = new(new SocketsHttpHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(2),
    };

    private readonly WebView2 _view = new();
    private readonly System.Windows.Forms.Timer _minTimer = new() { Interval = 900 };
    private readonly System.Windows.Forms.Timer _edgeTimer = new() { Interval = 30 };
    private readonly System.Windows.Forms.Timer _routeTimer = new() { Interval = 500 };
    private readonly bool _edgeHide;
    private Process? _server;
    private string _root = "";
    private bool _ready;
    private CoreWebView2Environment? _env;

    /// <summary>本机服务实际用的端口（页面、API、打印页都跟着它）</summary>
    private int _port = FirstPort;
    private string BaseUrl => $"http://127.0.0.1:{_port}";

    /// <summary>托盘菜单 / 第二次启动传进来的去处（如 settings），等页面就绪后再执行</summary>
    private string? _pendingRoute;

    /// <summary>心跳计数：每几拍刷新一次 instance.json，让别人知道这一份还活着</summary>
    private int _beatTicks;

    /// <summary>窗口最小尺寸（含边框的 CSS 像素），由页面报上来；WM_GETMINMAXINFO 里按 DPI 换算成物理像素</summary>
    private int _minTrackW = DefaultMinWidth;
    private int _minTrackH = DefaultMinWidth / 2;

    // 贴边抽屉：拖到屏幕顶边后，鼠标离开就滑上去，只留 4px；鼠标碰屏幕顶边再滑下来
    private bool _docked;
    private bool _entered;
    private DateTime _leaveAt;
    private DateTime _pinnedAt;
    private bool _sliding;

    public MainForm(bool edgeHide = false, string? initialRoute = null)
    {
        _edgeHide = edgeHide;
        if (!string.IsNullOrWhiteSpace(initialRoute)) _pendingRoute = initialRoute.Trim();
        Text = Title;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1380, 880);
        // 最小尺寸走 WM_GETMINMAXINFO（见 WndProc），不用 MinimumSize：
        // MinimumSize 会把边框也算进去，实际客户区会小一圈，页面就多出一条横向滚动条
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        _view.Dock = DockStyle.Fill;
        Controls.Add(_view);

        Load += async (_, _) => await BootAsync();
        FormClosing += OnFormClosing;
        _minTimer.Tick += async (_, _) => await SyncMinSizeAsync();
        _edgeTimer.Tick += (_, _) => EdgeTick();
        _routeTimer.Tick += (_, _) => PollRouteFile();

        // 纸条要尽早开始听：别的实例（比如托盘菜单）可能在界面还没起来的时候就喊我们
        _root = AppPaths.Root();
        if (_root.Length > 0) _routeTimer.Start();
    }

    // ---------------------------------------------------------------- 启动

    private async Task BootAsync()
    {
        _root = AppPaths.Root();
        if (_root.Length == 0)
        {
            ShowError("找不到程序目录。\nikuyoMail.exe 需要和 src、public、node_modules 放在同一个文件夹里。");
            return;
        }

        try
        {
            AppPaths.EnsureDataDir();
            // 日志只留这一次启动的，避免越攒越大
            File.WriteAllText(AppPaths.LogFile, "", new System.Text.UTF8Encoding(true));
        }
        catch (Exception ex)
        {
            ShowError("写不了程序目录里的 data 文件夹：\n" + ex.Message +
                      "\n\n请把 ikuyoMail 装到当前用户能写入的地方（别装到 C:\\Program Files）。");
            return;
        }

        Log("启动 " + Application.ExecutablePath);
        Log("程序目录 " + _root);

        RestoreWindowBox();

        if (!await EnsureServerAsync()) return;

        await InitWebViewAsync();
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            var dataDir = Path.Combine(_root, "data", "webview2");
            Directory.CreateDirectory(dataDir);
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            _env = env;
            await _view.EnsureCoreWebView2Async(env);

            var core = _view.CoreWebView2;
            // 邮件里的链接：站内的留在应用里，站外的丢给系统浏览器
            core.NewWindowRequested += (_, e) =>
            {
                if (e.Uri.StartsWith(BaseUrl, StringComparison.OrdinalIgnoreCase)) return;
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            core.NavigationStarting += (_, e) =>
            {
                if (e.Uri.StartsWith(BaseUrl, StringComparison.OrdinalIgnoreCase)) return;
                if (e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return;
                if (e.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            // 页面里的「另存为 PDF」走这里：宿主负责选路径、排版、落盘
            core.WebMessageReceived += OnWebMessage;
            core.NavigationCompleted += (_, _) => FlushRoute();

            _view.Source = new Uri(BaseUrl);
            _ready = true;
            _minTimer.Start();
            _beatTicks = 0;
            _routeTimer.Start();
            if (_edgeHide) _edgeTimer.Start();
            Log("界面就绪 " + BaseUrl);
            await SyncMinSizeAsync();
            FlushRoute();
        }
        catch (Exception ex)
        {
            Log("界面初始化失败：" + ex);
            ShowError("界面初始化失败：\n" + ex.Message + "\n\n如果没有安装 WebView2 运行时，装一下 Microsoft Edge WebView2 Runtime 即可。");
        }
    }

    // ---------------------------------------------------------------- 服务

    /// <summary>
    /// 找到（或者拉起）属于这一份 ikuyoMail 的本机服务。
    /// 端口不一定非得是 7317：那上面有可能挂着别的程序，或者挂着别的目录里那份 ikuyoMail 的服务。
    /// 认领规则：谁的身份（/api/identity 报告的程序目录）跟这一份一致，就复用谁；都不对就换个空端口自己起。
    /// </summary>
    private async Task<bool> EnsureServerAsync()
    {
        for (var port = FirstPort; port <= LastPort; port++)
        {
            if (await IsOurServerAsync(port))
            {
                _port = port;
                Log($"复用已有服务 port={port}");
                _server = null;    // 不是我们拉的，别在退出时错手杀掉
                return true;
            }

            if (await PortBusyAsync(port)) continue;   // 被别的程序占着，看下一个

            var node = FindNode();
            if (node is null)
            {
                ShowError("没有找到 Node.js。\n请先安装 Node.js（https://nodejs.org），或者在程序目录放一个 runtime\\node.exe。");
                return false;
            }
            Log($"启动 {node} port={port}");
            if (!StartServer(node, port)) continue;

            // 等服务起来：最多 30 秒
            var up = false;
            for (var i = 0; i < 60; i++)
            {
                await Task.Delay(500);
                if (await IsOurServerAsync(port))
                {
                    up = true;
                    break;
                }
                if (_server?.HasExited == true && i > 3)
                {
                    Log("node 进程已经退出，换端口重试");
                    break;
                }
            }
            if (up)
            {
                _port = port;
                Log($"服务已就绪 port={port}");
                return true;
            }
        }

        ShowError("本地服务没能启动。\n可以打开程序目录里的 data\\startup.log 看看最后一步卡在哪儿。");
        return false;
    }

    /// <summary>这个端口上的服务是不是「这一份」程序自己的</summary>
    private async Task<bool> IsOurServerAsync(int port)
    {
        try
        {
            using var resp = await Http.GetAsync($"http://127.0.0.1:{port}/api/identity");
            if (!resp.IsSuccessStatusCode) return false;
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            if (!doc.RootElement.TryGetProperty("root", out var rootEl)) return false;
            var remote = (rootEl.GetString() ?? "").Trim().TrimEnd('\\');
            return string.Equals(remote, _root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>这个端口有没有别人在监听（连得上就算被占）</summary>
    private static async Task<bool> PortBusyAsync(int port)
    {
        try
        {
            using var client = new TcpClient();
            await client.ConnectAsync(IPAddress.Loopback, port);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private bool StartServer(string node, int port)
    {
        var psi = new ProcessStartInfo(node, "src/server.js")
        {
            WorkingDirectory = _root,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        psi.EnvironmentVariables["PORT"] = port.ToString();
        try
        {
            _server = Process.Start(psi);
            return _server is not null;
        }
        catch (Exception ex)
        {
            Log("启动 node 失败：" + ex.Message);
            return false;
        }
    }

    private string? FindNode()
    {
        var local = Path.Combine(_root, "runtime", "node.exe");
        if (File.Exists(local)) return local;
        var programFiles = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (File.Exists(programFiles)) return programFiles;
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(dir.Trim('"'), "node.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private void StopServer()
    {
        if (_server is null) return;
        try
        {
            if (!_server.HasExited) _server.Kill(true);
        }
        catch { }
        _server = null;
    }

    // ---------------------------------------------------------------- 窗口最小尺寸

    /// <summary>
    /// 页面知道自己现在最少要多少像素（三栏 998 / 收起阅读区 552），高度取它的一半。
    /// 用 WM_GETMINMAXINFO 交给系统：拖到边界就停住，不需要事后纠正，也不会和拖动打架。
    /// </summary>
    private async Task SyncMinSizeAsync()
    {
        if (!_ready) return;
        try
        {
            var json = await Http.GetStringAsync(BaseUrl + "/api/ui/min-width");
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("width", out var wEl)) return;
            var w = wEl.GetInt32();
            if (w < 300) return;
            // 页面算的是「视口要多少」，浏览器里 window.outerWidth 会额外带上边框，
            // WebView2 里没有那层 chrome（差值为 0），所以边框要在这里自己补上
            var frameW = Math.Max(0, Width - ClientSize.Width);
            _minTrackW = w + frameW;
            _minTrackH = Math.Max(300, _minTrackW / 2);
        }
        catch { }
    }

    private const int WM_GETMINMAXINFO = 0x0024;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_GETMINMAXINFO && _minTrackW > 0)
        {
            var info = Marshal.PtrToStructure<MinMaxInfo>(m.LParam);
            var scale = DeviceDpi / 96.0;
            info.MinTrackSize.X = (int)Math.Ceiling(_minTrackW * scale);
            info.MinTrackSize.Y = (int)Math.Ceiling(_minTrackH * scale);
            Marshal.StructureToPtr(info, m.LParam, false);
            return;
        }
        base.WndProc(ref m);
    }

    // ---------------------------------------------------------------- 关闭行为

    /// <summary>
    /// 设置里选「最小化到状态栏」时，关窗只是把窗口藏起来，服务和托盘继续跑；
    /// 选「退出程序」就一起停掉。不读设置时按托盘模式处理（和浏览器版默认值一致）。
    /// </summary>
    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        // 关机 / 注销：不管设置怎么样都要真的退
        if (e.CloseReason == CloseReason.WindowsShutDown)
        {
            StopServer();
            return;
        }

        if (!_ready) return;

        var (closeAction, trayEnabled) = ReadCloseSettings();
        if (closeAction == "tray" && trayEnabled)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        StopServer();
    }

    private (string CloseAction, bool TrayEnabled) ReadCloseSettings()
    {
        try
        {
            var path = Path.Combine(_root, "data", "settings.json");
            if (!File.Exists(path)) return ("tray", true);
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var action = root.TryGetProperty("closeAction", out var a) ? a.GetString() ?? "tray" : "tray";
            var tray = !root.TryGetProperty("trayEnabled", out var t) || t.ValueKind != JsonValueKind.False;
            return (action, tray);
        }
        catch
        {
            return ("tray", true);
        }
    }

    // ---------------------------------------------------------------- 贴边抽屉

    /// <summary>
    /// 窗口拖到屏幕顶边后，鼠标离开 0.8 秒就滑上去只留一条 4px 的边；
    /// 鼠标碰到屏幕顶边（横向在窗口范围内）再滑下来。最大化时不参与。
    /// </summary>
    private void EdgeTick()
    {
        if (!_edgeHide || _sliding || !Visible) return;
        var work = Screen.FromControl(this).WorkingArea;

        if (WindowState == FormWindowState.Maximized)
        {
            _docked = false;
            return;
        }

        if (MouseButtons != MouseButtons.None) return;   // 用户正按着鼠标拖动，别插手

        var pos = Cursor.Position;
        var now = DateTime.UtcNow;

        if (_docked)
        {
            if (pos.Y <= work.Top + 2 && pos.X >= Left && pos.X <= Right)
            {
                SlideTo(work.Top);
                _docked = false;
                _entered = true;
                _leaveAt = default;
            }
            return;
        }

        if (Bounds.Contains(pos))
        {
            _entered = true;
            _leaveAt = default;
        }
        else if (_entered && _leaveAt == default)
        {
            _leaveAt = now;
        }

        var pinned = Top <= work.Top + 2;
        if (pinned)
        {
            if (_pinnedAt == default) _pinnedAt = now;
        }
        else
        {
            _pinnedAt = default;
        }

        if (_entered && pinned && _leaveAt != default && _pinnedAt != default &&
            (now - _leaveAt).TotalSeconds > 0.8 && (now - _pinnedAt).TotalSeconds > 0.8)
        {
            SlideTo(work.Top - (Height - 4));
            _docked = true;
        }
    }

    /// <summary>13 步 easeOutCubic 滑动，肉眼看起来是一下"抽"上去</summary>
    private void SlideTo(int targetTop)
    {
        _sliding = true;
        try
        {
            var start = Top;
            const int steps = 13;
            for (var i = 1; i <= steps; i++)
            {
                if (IsDisposed) return;
                var t = (double)i / steps;
                var eased = 1 - Math.Pow(1 - t, 3);
                Top = (int)Math.Round(start + (targetTop - start) * eased);
                Application.DoEvents();
                System.Threading.Thread.Sleep(12);
            }
            Top = targetTop;
        }
        finally
        {
            _sliding = false;
        }
    }

    // ---------------------------------------------------------------- 窗口位置

    private string BoundsPath => Path.Combine(_root, "data", "window.json");

    private void RestoreWindowBox()
    {
        try
        {
            if (!File.Exists(BoundsPath)) return;
            var b = JsonSerializer.Deserialize<WindowBox>(File.ReadAllText(BoundsPath));
            if (b is null || b.W < 400 || b.H < 300) return;
            var rect = new Rectangle(b.X, b.Y, b.W, b.H);
            // 只要跟当前任何一个屏幕有交集就还原，否则留在默认位置（比如拔掉了副屏）
            foreach (var screen in Screen.AllScreens)
            {
                if (screen.WorkingArea.IntersectsWith(rect))
                {
                    StartPosition = FormStartPosition.Manual;
                    Bounds = rect;
                    return;
                }
            }
        }
        catch { }
    }

    private void SaveBounds()
    {
        try
        {
            if (WindowState != FormWindowState.Normal) return;
            // 收起到屏幕外的时候记住的是正常位置，不然下次打开窗口在屏幕外面
            var top = Top;
            var work = Screen.FromControl(this).WorkingArea;
            if (_docked || top < work.Top) top = work.Top;
            var b = new WindowBox { X = Left, Y = top, W = Width, H = Height };
            File.WriteAllText(BoundsPath, JsonSerializer.Serialize(b));
        }
        catch { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        SaveBounds();
        StopServer();   // 兜底：不管从哪条路关的窗，都别把 Node 服务留在后台
        base.OnFormClosed(e);
    }

    // ---------------------------------------------------------------- 托盘 / 二次启动的去处

    /// <summary>第二个实例（比如托盘菜单）把「要打开设置」写在纸条上，这里定时来取</summary>
    private string RouteFilePath => Path.Combine(AppPaths.DataDir, "route.txt");

    private void PollRouteFile()
    {
        // 顺手刷新心跳：别的拷贝靠它判断「这份是不是还活着」
        if (++_beatTicks >= 4)
        {
            _beatTicks = 0;
            InstanceMark.Write();
        }

        try
        {
            var path = RouteFilePath;
            if (!File.Exists(path)) return;
            var text = File.ReadAllText(path).Trim();
            File.Delete(path);
            if (text.Length == 0) return;
            DispatchRoute(text);
        }
        catch
        {
            /* 文件正被写入 / 占用，下一拍再读 */
        }
    }

    private void DispatchRoute(string route)
    {
        route = route.TrimStart('#').Trim();
        if (route.Length == 0) return;
        // 不管要去哪儿，先把窗口露出来（可能在托盘里、也可能贴边收起了）
        RestoreWindow();
        if (route != "settings") return;
        _pendingRoute = route;
        FlushRoute();
    }

    private async void FlushRoute()
    {
        if (_pendingRoute is null || !_ready) return;
        var core = _view.CoreWebView2;
        if (core is null) return;
        var route = _pendingRoute;
        _pendingRoute = null;
        try
        {
            // 页面里的入口可能还没挂上，等 window.ikuyoMail 出现再说
            var up = false;
            for (var i = 0; i < 24; i++)
            {
                var probe = await core.ExecuteScriptAsync("typeof window.ikuyoMail");
                if (probe.Contains("object"))
                {
                    up = true;
                    break;
                }
                await Task.Delay(200);
            }
            if (!up)
            {
                _pendingRoute = route;
                return;
            }
            if (route == "settings") await core.ExecuteScriptAsync("window.ikuyoMail.openSettings()");
        }
        catch
        {
            _pendingRoute = route;
        }
    }

    /// <summary>窗口可能藏在托盘里、或者已经贴边收起，先把人叫回来再跳转</summary>
    private void RestoreWindow()
    {
        try
        {
            if (!Visible) Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            var work = Screen.FromControl(this).WorkingArea;
            if (_docked || Top < work.Top)
            {
                SlideTo(work.Top);
                _docked = false;
            }
            Activate();
            BringToFront();
        }
        catch
        {
            /* ignore */
        }
    }

    // ---------------------------------------------------------------- 另存为 PDF

    /// <summary>
    /// 页面点「另存为 PDF」后发来一条消息（WebView2 的 postMessage）。
    /// 这里只处理 save-pdf，其余消息忽略。
    /// </summary>
    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            if (type != "save-pdf") return;
            var acc = root.TryGetProperty("accountId", out var a) ? a.GetString() ?? "" : "";
            var folder = root.TryGetProperty("folder", out var f) ? f.GetString() ?? "INBOX" : "INBOX";
            var uid = root.TryGetProperty("uid", out var u) && u.TryGetInt32(out var uv) ? uv : 0;
            var subject = root.TryGetProperty("subject", out var s) ? s.GetString() ?? "" : "";
            if (acc.Length == 0 || uid <= 0) return;
            await SavePdfAsync(acc, folder, uid, subject);
        }
        catch
        {
            /* 消息格式不对就当没收到 */
        }
    }

    private async Task SavePdfAsync(string accountId, string folder, int uid, string subject)
    {
        var name = SafeFileName(subject);
        using var dlg = new SaveFileDialog
        {
            Title = "另存为 PDF",
            Filter = "PDF 文件 (*.pdf)|*.pdf",
            FileName = (name.Length > 0 ? name : $"邮件-{uid}") + ".pdf",
            DefaultExt = "pdf",
            AddExtension = true,
            OverwritePrompt = true,
        };
        var lastDir = ReadPdfDir();
        if (lastDir.Length > 0 && Directory.Exists(lastDir)) dlg.InitialDirectory = lastDir;

        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var path = dlg.FileName;
        try
        {
            WritePdfDir(Path.GetDirectoryName(path) ?? "");
        }
        catch
        {
            /* 记不住目录不影响导出 */
        }

        var ok = false;
        var error = "";
        try
        {
            ok = await RenderEmailPdfAsync(accountId, folder, uid, path);
            if (!ok) error = "PDF 生成失败，请稍后重试";
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        // 失败时别留一个 0 字节的空 PDF 在桌面上
        if (!ok)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                /* ignore */
            }
        }
        Toast(ok, path, error);
    }

    /// <summary>
    /// 打开「单封邮件排版页」，再把它打印成 A4 PDF。
    /// 打印的是邮件本身，不是主界面——主窗口全程不被碰。
    /// </summary>
    private Task<bool> RenderEmailPdfAsync(string accountId, string folder, int uid, string path)
    {
        if (_env is null) return Task.FromResult(false);
        var url =
            $"{BaseUrl}/print.html?acc={Uri.EscapeDataString(accountId)}" +
            $"&folder={Uri.EscapeDataString(folder)}&uid={uid}";
        return EmailPrinter.PrintAsync(_env, url, path);
    }

    private async void Toast(bool ok, string path, string error)
    {
        try
        {
            if (!_ready || _view.CoreWebView2 is null) return;
            var flag = ok ? "true" : "false";
            var p = JsonSerializer.Serialize(ok ? path : "");
            var msg = JsonSerializer.Serialize(ok ? "" : error.Length > 0 ? error : "PDF 生成失败");
            await _view.CoreWebView2.ExecuteScriptAsync(
                $"window.ikuyoMail&&window.ikuyoMail.pdfDone({flag},{p},{msg})");
        }
        catch
        {
            /* ignore */
        }
    }

    private static string SafeFileName(string s)
    {
        s = (s ?? "").Trim();
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, ' ');
        s = s.Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ');
        while (s.Contains("  ")) s = s.Replace("  ", " ");
        if (s.Length > 80) s = s.Substring(0, 80).Trim();
        return s.Trim().TrimEnd('.');
    }

    private string ReadPdfDir()
    {
        try
        {
            var f = Path.Combine(_root, "data", "pdf-dir.txt");
            return File.Exists(f) ? File.ReadAllText(f).Trim() : "";
        }
        catch
        {
            return "";
        }
    }

    private void WritePdfDir(string dir)
    {
        if (dir.Length == 0) return;
        try
        {
            var f = Path.Combine(_root, "data", "pdf-dir.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(f) ?? _root);
            File.WriteAllText(f, dir);
        }
        catch
        {
            /* ignore */
        }
    }

    // ---------------------------------------------------------------- 杂项

    private static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { }
    }

    /// <summary>启动日志写到 data\startup.log：用户反馈「打不开」的时候直接看它</summary>
    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(
                AppPaths.LogFile,
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}",
                new System.Text.UTF8Encoding(true));
        }
        catch
        {
            /* 连日志都写不了就算了 */
        }
    }

    private void ShowError(string message)
    {
        Log("出错：" + message.Replace('\n', ' '));
        Controls.Clear();
        var label = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Text = message + "\n\n（详细信息见程序目录里的 data\\startup.log）",
            Font = new Font("Microsoft YaHei UI", 11f),
            ForeColor = Color.FromArgb(120, 55, 55),
            Padding = new Padding(40),
        };
        Controls.Add(label);
    }

    private sealed class WindowBox
    {
        public int X { get; set; }
        public int Y { get; set; }
        public int W { get; set; }
        public int H { get; set; }
    }
}
