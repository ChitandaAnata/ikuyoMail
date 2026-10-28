using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using ikuyoMail.Setup;

namespace ikuyoMail;

/// <summary>
/// 卸载向导：和安装程序同一套扁平样式，走「确认 → 进度 → 完成」三步。
/// 真正的删除动作在 <see cref="UninstallJob"/> 里，静默卸载也走同一套。
/// </summary>
internal sealed class UninstallForm : Form
{
    internal enum Step { Confirm, Working, Done, Failed }

    private const int FormW = 620;
    private const int FormH = 424;

    private readonly string _dir;
    private readonly FlatCheck _keepData = new() { Text = "同时删除本机的邮件账号、备注和设置", Checked = false };
    private readonly FlatButton _go = new() { Primary = true, Text = "卸载" };
    private readonly FlatButton _cancel = new() { Primary = false, Text = "取消" };
    private readonly FlatCloseButton _close = new();
    private readonly FlatProgress _bar = new();

    private readonly string _size;
    private Step _step = Step.Confirm;
    private int _percent;
    private string _status = "";
    private string _fail = "";
    private bool _busy;

    /// <summary>卸载真的跑过了才做收尾：取消掉的话不能去删人家目录</summary>
    private bool _finished;

    public UninstallForm(string dir)
    {
        _dir = dir;
        _size = SizeOf(dir);
        Text = "卸载 ikuyoMail";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;
        Font = Theme.Body;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* ignore */ }

        ClientSize = new Size(S(FormW), S(FormH));
        MinimumSize = ClientSize;
        MaximumSize = ClientSize;

        _close.Click += (_, _) => TryClose();
        _cancel.Click += (_, _) => TryClose();
        _go.Click += (_, _) =>
        {
            if (_step == Step.Done || _step == Step.Failed) { Close(); return; }
            StartUninstall();
        };

        Controls.AddRange(new Control[] { _keepData, _go, _cancel, _close, _bar });
        LayoutControls();
        ApplyStep();
    }

    private int S(double v) => (int)Math.Round(v * DeviceDpi / 96.0);
    private float SF(double v) => (float)(v * DeviceDpi / 96.0);

    private void LayoutControls()
    {
        _close.Bounds = new Rectangle(S(FormW - 44), S(14), S(28), S(28));

        _keepData.Bounds = new Rectangle(S(32), S(256), S(FormW - 64), S(22));
        _bar.Bounds = new Rectangle(S(32), S(196), S(FormW - 64), S(8));

        _go.Bounds = new Rectangle(S(FormW - 32 - 132), S(360), S(132), S(40));
        _cancel.Bounds = new Rectangle(S(FormW - 32 - 132 - 8 - 88), S(360), S(88), S(40));
    }

    private void ApplyStep()
    {
        var confirm = _step == Step.Confirm;
        _keepData.Visible = confirm;
        _bar.Visible = _step == Step.Working;

        _go.Text = _step switch
        {
            Step.Done => "关闭",
            Step.Failed => "关闭",
            _ => "卸载",
        };
        _cancel.Visible = confirm;
        _go.Visible = _step != Step.Working;
        _close.Visible = _step != Step.Working;
        Invalidate();
    }

    private void StartUninstall()
    {
        _busy = true;
        _percent = 0;
        _status = "";
        SetStep(Step.Working);

        var keepData = !_keepData.Checked;
        Task.Run(() =>
        {
            try
            {
                UninstallJob.Run(_dir, keepData, (pct, text) =>
                {
                    try
                    {
                        BeginInvoke((Action)(() =>
                        {
                            _percent = pct;
                            _bar.Percent = pct;
                            _status = text;
                            Invalidate(new Rectangle(S(32), S(120), S(FormW - 64), S(120)));
                        }));
                    }
                    catch
                    {
                        /* 窗口已经关了 */
                    }
                });
                BeginInvoke((Action)(() =>
                {
                    _busy = false;
                    _finished = true;
                    _percent = 100;
                    SetStep(Step.Done);
                }));
            }
            catch (Exception ex)
            {
                BeginInvoke((Action)(() =>
                {
                    _busy = false;
                    _finished = true;
                    _fail = ex.Message;
                    SetStep(Step.Failed);
                }));
            }
        });
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
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.Clear(Color.White);

        switch (_step)
        {
            case Step.Confirm: DrawConfirm(g); break;
            case Step.Working: DrawWorking(g); break;
            case Step.Done: DrawDone(g); break;
            case Step.Failed: DrawFailed(g); break;
        }

        if (_step == Step.Working) return;
        using (var pen = new Pen(Theme.LineSoft, 1f))
            g.DrawLine(pen, S(32), S(340), S(FormW - 32), S(340));
        DrawText(g, "ikuyoMail V1.0.0", Theme.Tiny, S(32), S(370), Theme.FromHex("#B9B8BE"));
    }

    private void DrawConfirm(Graphics g)
    {
        DrawText(g, "卸载 ikuyoMail", Theme.H1, S(32), S(36), Theme.Ink);
        DrawWrapped(g, "会从这台电脑上移除下面的内容。卸载后如果想再用，重新运行安装程序就行。",
            Theme.Body, new Rectangle(S(32), S(86), S(FormW - 64), S(40)), Theme.Ink2);

        var rows = new[]
        {
            ("程序文件", _size + "，装在 " + Shorten(_dir)),
            ("快捷方式", "桌面和开始菜单里的 ikuyoMail"),
            ("应用和功能", "「设置 → 应用」里的 ikuyoMail 条目"),
        };
        var y = 136;
        foreach (var (title, desc) in rows)
        {
            using (var b = new SolidBrush(Theme.Accent))
                g.FillEllipse(b, S(34), S(y + 6), S(5), S(5));
            DrawText(g, title, Theme.BodyStrong, S(50), S(y), Theme.Ink);
            DrawText(g, desc, Theme.Small, S(50), S(y + 18), Theme.Muted,
                TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding |
                TextFormatFlags.PathEllipsis);
            y += 40;
        }

        DrawText(g, "不勾选的话，data 文件夹（账号、备注、设置）会留着，重装后接着用。",
            Theme.Tiny, S(50), S(288), Theme.FromHex("#B9B8BE"),
            TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding);
    }

    private void DrawWorking(Graphics g)
    {
        DrawText(g, "正在卸载", Theme.H1, S(32), S(36), Theme.Ink);
        DrawWrapped(g, "ikuyoMail 正在从这台电脑上移除，请稍候。",
            Theme.Body, new Rectangle(S(32), S(86), S(FormW - 64), S(30)), Theme.Ink2);

        var pct = $"{_percent}%";
        TextRenderer.DrawText(g, pct, Theme.H2, new Rectangle(S(32), S(150), S(FormW - 64), S(28)), Theme.Accent,
            TextFormatFlags.Right | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        DrawText(g, _status, Theme.Small, S(32), S(226), Theme.Muted,
            TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding |
            TextFormatFlags.PathEllipsis | TextFormatFlags.NoPrefix);
        DrawText(g, "过程中请不要关闭这个窗口，结束时会给你确认提示。", Theme.Tiny, S(32), S(258),
            Theme.FromHex("#B9B8BE"));
    }

    private void DrawDone(Graphics g)
    {
        DrawCheck(g);
        DrawText(g, "卸载完成", Theme.H1, S(32), S(196), Theme.Ink);
        DrawWrapped(g, "ikuyoMail 已经从这台电脑上移除了。感谢你的使用，欢迎随时装回来。",
            Theme.Body, new Rectangle(S(32), S(238), S(FormW - 64), S(50)), Theme.Ink2);
    }

    private void DrawFailed(Graphics g)
    {
        DrawText(g, "卸载没能完成", Theme.H1, S(32), S(36), Theme.Ink);
        var box = new Rectangle(S(32), S(96), S(FormW - 64), S(140));
        using (var path = Theme.Round(box, SF(10)))
        using (var b = new SolidBrush(Theme.AccentSoft))
            g.FillPath(b, path);
        DrawWrapped(g, _fail + "\n\n可以关掉这个窗口重试一次；如果一直失败，手动删掉安装目录也可以。",
            Theme.Small, new Rectangle(S(48), S(112), S(FormW - 96), S(110)), Theme.FromHex("#9B3B31"));
    }

    private void DrawCheck(Graphics g)
    {
        var side = SF(56);
        var box = new RectangleF(SF(32), SF(118), side, side);
        using (var b = new SolidBrush(Theme.Accent))
            g.FillEllipse(b, box);
        using var pen = new Pen(Color.White, Math.Max(2.4f, SF(3)))
        {
            StartCap = System.Drawing.Drawing2D.LineCap.Round,
            EndCap = System.Drawing.Drawing2D.LineCap.Round,
            LineJoin = System.Drawing.Drawing2D.LineJoin.Round,
        };
        g.DrawLines(pen, new[]
        {
            new PointF(box.X + side * 0.28f, box.Y + side * 0.53f),
            new PointF(box.X + side * 0.44f, box.Y + side * 0.69f),
            new PointF(box.X + side * 0.73f, box.Y + side * 0.34f),
        });
    }

    /// <summary>目录大概占多少（算不出来就不显示）</summary>
    private static string SizeOf(string dir)
    {
        try
        {
            long total = 0;
            foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; } catch { /* 跳过读不到的 */ }
            }
            if (total <= 0) return "程序文件";
            var mb = total / 1024d / 1024d;
            return mb >= 1024 ? (mb / 1024).ToString("0.0") + " GB" : Math.Round(mb).ToString("0") + " MB";
        }
        catch
        {
            return "程序文件";
        }
    }

    private static string Shorten(string dir) =>
        dir.Length <= 46 ? dir : dir.Substring(0, 20) + "…" + dir.Substring(dir.Length - 24);

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

    /// <summary>仅供自检：把界面切到某个状态（--uninstall-shot 用）</summary>
    internal void Preview(string state)
    {
        switch (state)
        {
            case "working":
                _percent = 64;
                _status = "正在删除程序文件…";
                _bar.Percent = 64;
                SetStep(Step.Working);
                break;
            case "done":
                SetStep(Step.Done);
                break;
            case "failed":
                _fail = "拒绝访问某个正在被占用的文件。";
                SetStep(Step.Failed);
                break;
        }
    }

    // ---------------------------------------------------------------- 窗口行为

    private void TryClose()
    {
        if (_busy) return;
        Close();
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

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        base.OnFormClosed(e);
        // 收尾交给临时批处理：本进程退出后把临时副本清掉；真卸载过的话连空目录一起清
        UninstallJob.ScheduleCleanup(_dir, _keepDataChecked, _finished);
    }

    private bool _keepDataChecked => !_keepData.Checked;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ClassStyle |= 0x00020000; // CS_DROPSHADOW
            return cp;
        }
    }

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
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
            /* Win10 没有这个属性 */
        }
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
}

/// <summary>真正干活的部分：关进程、删快捷方式、删注册表项、删文件，最后排一个收尾批处理</summary>
internal static class UninstallJob
{
    public const string AppName = "ikuyoMail";
    public const string RegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ikuyoMail";

    public static void Run(string dir, bool keepData, Action<int, string> report)
    {
        report(2, "正在关闭 ikuyoMail…");
        StopProcesses(dir);
        Thread.Sleep(600);   // 给 WebView2 的子进程一点时间自己退出，松开 data\\webview2

        report(8, "正在移除快捷方式…");
        RemoveShortcuts();

        report(14, "正在清理「应用和功能」条目…");
        try { Registry.CurrentUser.DeleteSubKeyTree(RegPath, false); } catch { /* 已经没了 */ }

        report(20, "正在删除程序文件…");
        var failed = DeleteTree(dir, keepData, pct => report(20 + pct * 70 / 100, "正在删除程序文件…"));

        // WebView2 的子进程有时会晚一步松手，等半秒再来一遍
        if (failed > 0)
        {
            report(92, "正在收尾…");
            Thread.Sleep(900);
            failed = DeleteTree(dir, keepData, _ => { });
        }

        report(96, "正在收尾…");
        if (failed == 0) TryDeleteEmptyDir(dir, keepData);
        report(100, "卸载完成");
    }

    /// <summary>关掉这个目录里的 ikuyoMail 和它拉起的 node，否则文件删不掉</summary>
    private static void StopProcesses(string dir)
    {
        foreach (var name in new[] { "ikuyoMail", "Uninstall" })
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                if (p.Id == Environment.ProcessId) continue;
                try
                {
                    var exe = p.MainModule?.FileName ?? "";
                    if (exe.Length == 0 || exe.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill(true);
                }
                catch
                {
                    /* 关不掉就交给后面的重试 */
                }
            }
        }

        foreach (var p in Process.GetProcessesByName("node"))
        {
            try
            {
                var exe = p.MainModule?.FileName ?? "";
                if (exe.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill(true);
            }
            catch
            {
                /* 权限不够就跳过 */
            }
        }
    }

    private static void RemoveShortcuts()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"Microsoft\Windows\Start Menu\Programs");
        var folder = Path.Combine(startMenu, AppName);

        Try(() => { if (File.Exists(Path.Combine(desktop, AppName + ".lnk"))) File.Delete(Path.Combine(desktop, AppName + ".lnk")); });
        Try(() => { if (Directory.Exists(folder)) Directory.Delete(folder, true); });
        Try(() => { if (File.Exists(Path.Combine(startMenu, AppName + ".lnk"))) File.Delete(Path.Combine(startMenu, AppName + ".lnk")); });
    }

    /// <summary>删掉目录里的东西（keepData 时留下 data）；返回删不掉的条目数</summary>
    private static int DeleteTree(string dir, bool keepData, Action<int> report)
    {
        if (!Directory.Exists(dir)) return 0;

        string[] dirs, files;
        try
        {
            dirs = Directory.GetDirectories(dir);
            files = Directory.GetFiles(dir);
        }
        catch
        {
            return 1;
        }

        // data 要留就整个跳过
        if (keepData) dirs = dirs.Where(d => !Path.GetFileName(d).Equals("data", StringComparison.OrdinalIgnoreCase)).ToArray();
        // WebView2 的缓存目录也可能在根上
        var total = Math.Max(1, dirs.Length + files.Length);
        var done = 0;
        var failed = 0;

        foreach (var d in dirs)
        {
            try { Directory.Delete(d, true); }
            catch { failed++; }
            report(++done * 100 / total);
        }
        foreach (var f in files)
        {
            try { File.Delete(f); }
            catch { failed++; }
            report(++done * 100 / total);
        }

        if (failed > 0) TryDeleteEmptyDir(dir, keepData);
        return failed;
    }

    private static void TryDeleteEmptyDir(string dir, bool keepData)
    {
        if (!keepData)
        {
            Try(() => { if (Directory.Exists(dir)) Directory.Delete(dir, false); });
            return;
        }
        // 保留 data：目录留着，但把 data 挪个位置不至于让用户以为没卸干净？
        // 不挪——直接把 data 留在安装目录里，重装时能接着用。
    }

    /// <summary>
    /// 等本进程退出后清掉临时副本和批处理自己；removeProgram 为真时连空壳目录一起清
    /// （用户点了取消就只删临时副本，不能动人家装好的东西）
    /// </summary>
    public static void ScheduleCleanup(string dir, bool keepData, bool removeProgram)
    {
        var bat = Path.Combine(Path.GetTempPath(), "ikuyomail-uninstall-" + Guid.NewGuid().ToString("N")[..8] + ".cmd");
        var sb = new StringBuilder();
        sb.AppendLine("@echo off");
        sb.AppendLine("timeout /t 2 /nobreak >nul");
        if (!removeProgram)
        {
            // 只收拾临时副本
        }
        else if (keepData)
        {
            sb.AppendLine($"for /d %%D in (\"{dir}\\*\") do if /i not \"%%~nxD\"==\"data\" rd /s /q \"%%D\"");
            sb.AppendLine($"for %%F in (\"{dir}\\*\") do del /f /q \"%%F\"");
        }
        else
        {
            sb.AppendLine($"rd /s /q \"{dir}\"");
        }
        // 临时副本（如果是从 %TEMP% 跑的那份）
        sb.AppendLine("for %%F in (\"%TEMP%\\ikuyoMail-uninstall-*.exe\") do del /f /q \"%%F\"");
        sb.AppendLine("del /f /q \"%~f0\"");
        try
        {
            File.WriteAllText(bat, sb.ToString(), new UTF8Encoding(false));
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c \"{bat}\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
        }
        catch
        {
            /* 批处理写不出来就留在原地，用户手动删也行 */
        }
    }

    private static void Try(Action action)
    {
        try
        {
            action();
        }
        catch
        {
            /* ignore */
        }
    }
}
