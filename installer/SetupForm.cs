using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ikuyoMail.Setup;

/// <summary>安装向导：单页，左边是插画，右边是安装选项与进度</summary>
public sealed class SetupForm : Form
{
    private enum Step { Ready, Installing, Done, Failed }

    private const int LeftW = 300;
    private const int FormW = 780;
    private const int FormH = 470;
    private const string WebView2Url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    private readonly FlatInput _path = new();
    private readonly FlatButton _browse = new() { Primary = false, Text = "浏览…" };
    private readonly FlatCheck _desktop = new() { Text = "创建桌面快捷方式", Checked = true };
    private readonly FlatButton _go = new() { Primary = true, Text = "开始安装" };
    private readonly FlatButton _cancel = new() { Primary = false, Text = "取消" };
    private readonly FlatCloseButton _close = new();
    private readonly FlatProgress _bar = new();

    private readonly Image? _hero;
    private readonly bool _hasWebView2;

    private Step _step = Step.Ready;
    private int _percent;
    private string _status = "";
    private string _fail = "";
    private string _target = "";
    private Rectangle _linkRect = Rectangle.Empty;
    private bool _busy;

    public SetupForm(string? presetDir = null)
    {
        Text = $"安装 {Payload.AppName}";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;
        Font = Theme.Body;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* ignore */ }

        _hero = Assets.Hero;
        _hasWebView2 = DetectWebView2();

        ClientSize = new Size(S(FormW), S(FormH));
        MinimumSize = ClientSize;
        MaximumSize = ClientSize;

        _path.Text = presetDir ?? Payload.ExistingDir() ?? Payload.DefaultDir;
        // 手动输入也一样：光标离开后把路径规整成「<选的目录>\ikuyoMail」
        _path.Box.Leave += (_, _) =>
        {
            var v = WithAppFolder(_path.Text);
            if (v.Length > 0) _path.Text = v;
        };

        _close.Click += (_, _) => TryCancel();
        _browse.Click += (_, _) => BrowseFolder();
        _cancel.Click += (_, _) => TryCancel();
        _go.Click += (_, _) =>
        {
            if (_step == Step.Done) { Payload.Launch(_target); Close(); }
            else if (_step == Step.Failed) SetStep(Step.Ready);
            else StartInstall();
        };

        Controls.AddRange(new Control[] { _path, _browse, _desktop, _go, _cancel, _close, _bar });
        LayoutControls();
        ApplyStep();
    }

    private int S(double v) => (int)Math.Round(v * DeviceDpi / 96.0);
    private float SF(double v) => (float)(v * DeviceDpi / 96.0);

    // ---------------------------------------------------------------- 布局

    private void LayoutControls()
    {
        const int x = 336, w = 406;

        _close.Bounds = new Rectangle(S(FormW - 44), S(14), S(28), S(28));

        _path.Bounds = new Rectangle(S(x), S(172), S(286), S(40));
        _browse.Bounds = new Rectangle(S(x + 296), S(172), S(110), S(40));
        _desktop.Bounds = new Rectangle(S(x), S(236), S(w), S(22));

        _bar.Bounds = new Rectangle(S(x), S(208), S(w), S(8));

        _go.Bounds = new Rectangle(S(x + w - 152), S(392), S(152), S(42));
        _cancel.Bounds = new Rectangle(S(x + w - 152 - 8 - 88), S(392), S(88), S(42));
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        ClientSize = new Size(S(FormW), S(FormH));
        MinimumSize = ClientSize;
        MaximumSize = ClientSize;
        LayoutControls();
        Invalidate(true);
    }

    private void ApplyStep()
    {
        var ready = _step == Step.Ready;
        var done = _step == Step.Done;

        _path.Visible = ready;
        _browse.Visible = ready;
        _desktop.Visible = ready;
        _bar.Visible = _step == Step.Installing;

        _go.Text = _step switch
        {
            Step.Done => "启动 ikuyoMail",
            Step.Failed => "重新安装",
            _ => "开始安装",
        };
        _cancel.Text = ready ? "取消" : "关闭";
        _go.Bounds = _step == Step.Done
            ? new Rectangle(S(336 + 406 - 152), S(392), S(152), S(42))
            : new Rectangle(S(336 + 406 - 152), S(392), S(152), S(42));
        _cancel.Visible = _step != Step.Installing;
        _go.Visible = _step != Step.Installing;
        _close.Visible = _step != Step.Installing;
        Invalidate();
    }

    private void SetStep(Step step)
    {
        _step = step;
        ApplyStep();
    }

    // ---------------------------------------------------------------- 绘制

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Color.White);

        DrawLeft(g);
        DrawRight(g);
    }

    private void DrawLeft(Graphics g)
    {
        var h = ClientSize.Height;
        using (var b = new SolidBrush(Theme.Panel))
            g.FillRectangle(b, new Rectangle(0, 0, S(LeftW), h));
        using (var pen = new Pen(Theme.FromHex("#F2E4E1"), 1f))
            g.DrawLine(pen, S(LeftW) - 1, 0, S(LeftW) - 1, h);

        DrawText(g, "ikuyoMail", Theme.Wordmark, S(34), S(44), Theme.Ink);
        DrawText(g, "本地邮箱客户端", Theme.Small, S(34), S(112), Theme.FromHex("#A88F8B"));

        // 版本小胶囊
        var pill = new RectangleF(SF(34), SF(76), SF(64), SF(21));
        using (var path = Theme.Round(pill, SF(10.5)))
        using (var b = new SolidBrush(Color.White))
            g.FillPath(b, path);
        TextRenderer.DrawText(g, "V" + Payload.Version, Theme.Tiny, Rectangle.Round(pill), Theme.Accent,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        if (_hero is null) return;
        var box = ImageBox();
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(_hero, box);
    }

    private Rectangle ImageBox()
    {
        var width = SF(210);
        var height = width * 345f / 265f;
        return new Rectangle(
            S((LeftW - 210) / 2.0),
            (int)Math.Round(ClientSize.Height - height - SF(26)),
            (int)Math.Round(width),
            (int)Math.Round(height));
    }

    private void DrawRight(Graphics g)
    {
        const int x = 336, w = 406;

        switch (_step)
        {
            case Step.Ready:
                DrawText(g, "安装 ikuyoMail", Theme.H1, S(x), S(44), Theme.Ink);
                DrawWrapped(g,
                    "本地运行的通用邮箱客户端，支持 QQ / 163 / Gmail / Outlook 等主流邮箱。",
                    Theme.Body, new Rectangle(S(x), S(86), S(w), S(40)), Theme.Ink2);

                DrawText(g, "安装位置", Theme.Small, S(x), S(146), Theme.Ink2);
                DrawText(g, "会装在所选目录下的 ikuyoMail 文件夹里，重装时直接覆盖。",
                    Theme.Tiny, S(x), S(272), Theme.FromHex("#B9B8BE"),
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding |
                    TextFormatFlags.PathEllipsis | TextFormatFlags.NoPrefix);
                DrawFoot(g);
                break;

            case Step.Installing:
                DrawText(g, "正在安装", Theme.H1, S(x), S(44), Theme.Ink);
                DrawText(g, "请稍候，装完就可以直接收信了。", Theme.Body, S(x), S(86), Theme.Ink2);

                var pct = $"{_percent}%";
                TextRenderer.DrawText(g, pct, Theme.H2, new Rectangle(S(x), S(166), S(w), S(28)), Theme.Accent,
                    TextFormatFlags.Right | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
                DrawText(g, "正在解压 " + _status, Theme.Small, S(x), S(230), Theme.Muted,
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.PathEllipsis);
                DrawWrapped(g, "安装到 " + _target, Theme.Small,
                    new Rectangle(S(x), S(256), S(w), S(38)), Theme.Muted);
                DrawText(g, "过程中请不要关闭这个窗口，装完会自己结束。", Theme.Tiny, S(x), S(300),
                    Theme.FromHex("#B9B8BE"));
                break;

            case Step.Done:
                DrawCheck(g);
                DrawText(g, "安装完成", Theme.H1, S(x), S(206), Theme.Ink);
                DrawWrapped(g,
                    "ikuyoMail 已经装好了，桌面和开始菜单里都能找到它。第一次打开时按提示添加邮箱账号即可。",
                    Theme.Body, new Rectangle(S(x), S(248), S(w), S(56)), Theme.Ink2);
                break;

            case Step.Failed:
                DrawText(g, "安装没能完成", Theme.H1, S(x), S(44), Theme.Ink);
                var box = new Rectangle(S(x), S(96), S(w), S(126));
                using (var path = Theme.Round(box, SF(10)))
                using (var b = new SolidBrush(Theme.AccentSoft))
                    g.FillPath(b, path);
                DrawWrapped(g, _fail, Theme.Small,
                    new Rectangle(S(x + 16), S(112), S(w - 32), S(96)), Theme.FromHex("#9B3B31"));
                break;
        }

        if (_step == Step.Installing) return;

        // 页脚：一条细线 + 左下角版本号，把按钮区托住
        using (var pen = new Pen(Theme.LineSoft, 1f))
            g.DrawLine(pen, S(x), S(366), S(x + w), S(366));
        DrawText(g, "ikuyoMail V" + Payload.Version, Theme.Tiny, S(x), S(404), Theme.FromHex("#B9B8BE"));
    }

    private void DrawFoot(Graphics g)
    {
        const int x = 336, w = 406;
        if (!_hasWebView2)
        {
            var link = "没检测到 WebView2 运行时，点这里下载安装（否则程序打不开）。";
            var rect = new Rectangle(S(x), S(300), S(w), S(20));
            DrawText(g, link, Theme.Small, rect.Left, rect.Top, Theme.Accent,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
            _linkRect = rect;
            return;
        }
        _linkRect = Rectangle.Empty;
    }

    private void DrawCheck(Graphics g)
    {
        var side = SF(56);
        var box = new RectangleF(SF(336), SF(128), side, side);
        using (var b = new SolidBrush(Theme.Accent))
            g.FillEllipse(b, box);
        using var pen = new Pen(Color.White, Math.Max(2.4f, SF(3)))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round,
        };
        g.DrawLines(pen, new[]
        {
            new PointF(box.X + side * 0.28f, box.Y + side * 0.53f),
            new PointF(box.X + side * 0.44f, box.Y + side * 0.69f),
            new PointF(box.X + side * 0.73f, box.Y + side * 0.34f),
        });
    }

    private static void DrawText(Graphics g, string text, Font font, int x, int y, Color color,
        TextFormatFlags flags = TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding)
    {
        TextRenderer.DrawText(g, text, font, new Point(x, y), color, flags | TextFormatFlags.NoPrefix);
    }

    private static void DrawWrapped(Graphics g, string text, Font font, Rectangle rect, Color color)
    {
        TextRenderer.DrawText(g, text, font, rect, color,
            TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
    }

    /// <summary>仅供自检：把界面切到某个状态（--shot 用）</summary>
    internal void PreviewState(string step)
    {
        switch (step)
        {
            case "installing":
                _target = _path.Text;
                _percent = 46;
                _status = "依赖库 imapflow";
                _bar.Percent = 46;
                SetStep(Step.Installing);
                break;
            case "done":
                _target = _path.Text;
                SetStep(Step.Done);
                break;
            case "failed":
                _fail = "安装过程中出错了。\n拒绝访问路径“C:////Program Files\\ikuyoMail”。\n\n可以换个安装位置再试一次；如果提示文件被占用，先退出正在运行的 ikuyoMail。";
                SetStep(Step.Failed);
                break;
        }
    }

    // ---------------------------------------------------------------- 交互

    private void BrowseFolder()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择 ikuyoMail 的安装位置",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
            SelectedPath = Directory.Exists(_path.Text) ? _path.Text : Payload.DefaultDir,
        };
        if (dialog.ShowDialog(this) == DialogResult.OK) _path.Text = WithAppFolder(dialog.SelectedPath);
    }

    /// <summary>
    /// 选到哪一层都行，程序总装在它下面的 ikuyoMail 文件夹里：
    /// 选 H:\ → H:\ikuyoMail；选 H:\Apps → H:\Apps\ikuyoMail；已经选了 ikuyoMail 就不再套一层。
    /// </summary>
    internal static string WithAppFolder(string picked)
    {
        var raw = (picked ?? "").Trim().Trim('"');
        if (raw.Length == 0) return "";

        string full;
        try
        {
            full = Path.GetFullPath(raw);
        }
        catch
        {
            return raw;
        }

        var trimmed = full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (trimmed.Length == 2 && trimmed[1] == ':') trimmed += Path.DirectorySeparatorChar.ToString();  // 盘符根
        var leaf = Path.GetFileName(trimmed.TrimEnd(Path.DirectorySeparatorChar));
        if (leaf.Equals(Payload.AppName, StringComparison.OrdinalIgnoreCase))
            return trimmed.TrimEnd(Path.DirectorySeparatorChar);
        return Path.Combine(trimmed, Payload.AppName);
    }

    private void TryCancel()
    {
        if (_busy) return;
        if (_step == Step.Done) { Close(); return; }
        Close();
    }

    private async void StartInstall()
    {
        var dir = WithAppFolder(_path.Text);
        _path.Text = dir;
        if (dir.Length < 3 || !Path.IsPathFullyQualified(dir))
        {
            MessageBox.Show(this, "请填写一个完整的安装路径，例如 D:\\Apps\\ikuyoMail。", "路径不对",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        if (!Payload.HasEnoughSpace(dir))
        {
            var free = Payload.FormatSize(Payload.TotalBytes);
            MessageBox.Show(this, $"这个磁盘剩的空间不够（需要约 {free}）。换个位置，或者先清一点空间。", "空间不足",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        _target = dir;
        _percent = 0;
        _bar.Percent = 0;
        _status = "";
        _busy = true;
        SetStep(Step.Installing);

        try
        {
            IProgress<(int Pct, string Name)> progress = new Progress<(int Pct, string Name)>(t =>
            {
                _percent = t.Pct;
                _bar.Percent = t.Pct;
                _status = t.Name;
                Invalidate(new Rectangle(S(336), S(140), S(406), S(150)));
            });

            await Payload.InstallAsync(dir, (pct, name) => progress.Report((pct, name)));
            Payload.CreateUninstaller(dir);
            Payload.CreateShortcuts(dir, _desktop.Checked);
            if (!_desktop.Checked) Payload.RemoveDesktopShortcut();
            Payload.Register(dir);

            _busy = false;
            SetStep(Step.Done);
        }
        catch (Exception ex)
        {
            _busy = false;
            _fail = "安装过程中出错了。" +
                    "\n" + ex.Message +
                    "\n\n可以换个安装位置再试一次；如果提示文件被占用，先退出正在运行的 ikuyoMail。";
            Log("install failed: " + ex);
            SetStep(Step.Failed);
        }
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(Path.Combine(Path.GetTempPath(), "ikuyomail-setup.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}",
                new System.Text.UTF8Encoding(true));
        }
        catch
        {
            /* ignore */
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (_busy)
        {
            e.Cancel = true;
            return;
        }
        base.OnFormClosing(e);
    }

    // 无边框窗口：空白处按住就能挪动
    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        Cursor = !_linkRect.IsEmpty && _linkRect.Contains(e.Location) ? Cursors.Hand : Cursors.Default;
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (_step == Step.Ready && !_linkRect.IsEmpty && _linkRect.Contains(e.Location))
        {
            try { Process.Start(new ProcessStartInfo(WebView2Url) { UseShellExecute = true }); } catch { /* ignore */ }
        }
    }

    // Win11 上让无边框窗口有圆角和投影
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
            return cp;
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // 到这里 DPI 才确定：按真实缩放重算窗口大小和控件位置
        ClientSize = new Size(S(FormW), S(FormH));
        MinimumSize = ClientSize;
        MaximumSize = ClientSize;
        LayoutControls();
        Invalidate(true);
        try
        {
            var round = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        }
        catch
        {
            /* Win10 没有这个属性，方角也能用 */
        }
    }

    private static bool DetectWebView2()
    {
        const string id = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        foreach (var root in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            foreach (var prefix in new[] { @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\", @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" })
            {
                try
                {
                    using var key = root.OpenSubKey(prefix + id);
                    var version = key?.GetValue("pv") as string;
                    if (!string.IsNullOrWhiteSpace(version) && version != "0.0.0.0") return true;
                }
                catch
                {
                    /* ignore */
                }
            }
        }
        return false;
    }
}

internal static class Assets
{
    private static Image? _hero;

    public static Image? Hero
    {
        get
        {
            if (_hero is not null) return _hero;
            try
            {
                using var stream = typeof(Assets).Assembly.GetManifestResourceStream("hero.png");
                if (stream is null) return null;
                using var buffer = new MemoryStream();
                stream.CopyTo(buffer);
                buffer.Position = 0;
                _hero = Image.FromStream(buffer);
                return _hero;
            }
            catch
            {
                return null;
            }
        }
    }
}
