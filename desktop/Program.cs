using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ikuyoMail;

internal static class Program
{
    private static Mutex? _instance;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string? className, string windowName);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int cmd);

    [STAThread]
    private static void Main(string[] args)
    {
        // 卸载：安装目录里的 Uninstall.exe（与 ikuyoMail.exe 同一个文件），
        // 或者「应用和功能」里登记的 ikuyoMail.exe --uninstall
        var exeName = Path.GetFileNameWithoutExtension(Application.ExecutablePath) ?? "";
        var looksLikeUninstaller =
            exeName.Equals("uninstall", StringComparison.OrdinalIgnoreCase) ||
            exeName.Equals("卸载", StringComparison.OrdinalIgnoreCase) ||
            exeName.Equals("卸载ikuyomail", StringComparison.OrdinalIgnoreCase) ||
            exeName.StartsWith("unins", StringComparison.OrdinalIgnoreCase);

        if (looksLikeUninstaller || args.Any(a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase)))
        {
            ApplicationConfiguration.Initialize();
            Uninstaller.Run(args);
            return;
        }

        // 自检：把卸载窗口画成 PNG 就退出（不删任何东西）
        var shot = args.FirstOrDefault(a => a.StartsWith("--uninstall-shot=", StringComparison.OrdinalIgnoreCase));
        if (shot is not null)
        {
            ApplicationConfiguration.Initialize();
            CaptureUninstall(shot.Substring("--uninstall-shot=".Length), ArgValue(args, "--step="), ArgValue(args, "--dir="));
            return;
        }

        // 开发自检：把一封邮件排版后打印成 PDF 就退出（不碰主窗口）
        var probe = args
            .FirstOrDefault(a => a.StartsWith("--pdf-test=", StringComparison.OrdinalIgnoreCase));
        if (probe is not null)
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new PrintProbeForm(probe.Substring("--pdf-test=".Length)));
            return;
        }

        // 托盘菜单的「设置…」会用 ikuyoMail.exe settings 叫起程序
        var route = args
            .Select(a => a.Trim())
            .Where(a => a.Length > 0 && !a.StartsWith("-", StringComparison.Ordinal))
            .Select(a => a.TrimStart('#'))
            .FirstOrDefault() ?? "";

        // 单实例：只拦「同一个目录里已经开着的这一份」。
        // 装在别处的另一份 ikuyoMail 是另一回事，得让人家正常开自己的窗口。
        _instance = AcquireLock(out var isFirst);

        if (!isFirst)
        {
            // 锁可能只是被强杀/崩溃的进程留下的：只有确认对面真的活着才让路
            Thread.Sleep(400);
            if (InstanceMark.Alive())
            {
                // 没指定去处就写个 open：窗口可能正藏在托盘里或贴边收起，需要它自己弹回来
                WriteRoute(route.Length > 0 ? route : "open");
                WakeWindow();
                return;
            }
            // 对面已经不在了，这个进程顶上
        }

        InstanceMark.Write();
        ApplicationConfiguration.Initialize();
        try
        {
            // 默认开启「拖到屏幕顶边自动收起」；加 --no-edge-hide 关掉
            var edgeHide = !args.Any(a => a.Equals("--no-edge-hide", StringComparison.OrdinalIgnoreCase));
            Application.Run(new MainForm(edgeHide, route));
        }
        finally
        {
            InstanceMark.Remove();
        }
        GC.KeepAlive(_instance);
    }

    /// <summary>抢单实例锁。上一个进程被强杀会留下 Abandoned 状态，那时线程同样拿到了所有权</summary>
    private static Mutex AcquireLock(out bool isFirst)
    {
        var mutex = new Mutex(false, AppPaths.MutexName);
        try
        {
            try
            {
                isFirst = mutex.WaitOne(TimeSpan.Zero, false);
            }
            catch (AbandonedMutexException)
            {
                // 锁的主人不复存在，所有权已经落到这个线程头上
                isFirst = true;
            }
        }
        catch
        {
            // 抢不到锁名的极端情况：当成「没人占着」，宁可开两个窗口也别让用户打不开
            isFirst = true;
        }
        return mutex;
    }

    private static void WakeWindow()
    {
        try
        {
            var h = FindWindow(null, "ikuyoMail");
            // 首次启动的那个可能还在初始化窗口，给它一点时间
            for (var i = 0; i < 40 && h == IntPtr.Zero; i++)
            {
                Thread.Sleep(150);
                h = FindWindow(null, "ikuyoMail");
            }
            if (h != IntPtr.Zero)
            {
                ShowWindow(h, 9); // SW_RESTORE
                SetForegroundWindow(h);
            }
        }
        catch
        {
            /* ignore */
        }
    }

    /// <summary>写一张「待办纸条」给已经开着的窗口；写不进去也不影响唤回窗口</summary>
    private static void WriteRoute(string route)
    {
        try
        {
            AppPaths.EnsureDataDir();
            File.WriteAllText(AppPaths.RouteFile, route);
        }
        catch
        {
            /* ignore */
        }
    }

    /// <summary>把卸载窗口画成 PNG（--uninstall-shot 用，只为出图核对，不动任何文件）</summary>
    private static void CaptureUninstall(string path, string? step, string? dirArg)
    {
        var dir = string.IsNullOrWhiteSpace(dirArg)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "ikuyoMail")
            : dirArg;
        using var form = new UninstallForm(dir);
        form.Show();
        Application.DoEvents();
        form.PerformLayout();
        if (!string.IsNullOrEmpty(step)) form.Preview(step);
        Application.DoEvents();
        Thread.Sleep(150);
        Application.DoEvents();

        var size = form.ClientSize;
        using var bmp = new System.Drawing.Bitmap(size.Width, size.Height);
        form.DrawToBitmap(bmp, new System.Drawing.Rectangle(0, 0, size.Width, size.Height));
        bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        form.Hide();
    }

    private static string? ArgValue(string[] args, string prefix) =>
        args.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            ?.Substring(prefix.Length);
}
