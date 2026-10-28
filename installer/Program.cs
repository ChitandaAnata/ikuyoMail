using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace ikuyoMail.Setup;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        // 静默安装：ikuyoMail-Setup.exe /S [--dir=D:\Apps\ikuyoMail] [--log=%TEMP%\x.log]
        if (args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase) ||
                          a.Equals("--silent", StringComparison.OrdinalIgnoreCase)))
        {
            Environment.ExitCode = Silent(args);
            return;
        }

        // 自检：把窗口画成 PNG 就退出（不装任何东西）
        var shot = Arg(args, "--shot=");
        if (!string.IsNullOrEmpty(shot))
        {
            Capture(shot, Arg(args, "--step="));
            return;
        }

        // 自检：只看「选的目录会被规整成什么」——不装任何东西
        var pathTest = Arg(args, "--path-test=");
        if (!string.IsNullOrEmpty(pathTest))
        {
            Console.WriteLine(SetupForm.WithAppFolder(pathTest));
            return;
        }

        var dir = Arg(args, "--dir=");
        Application.Run(new SetupForm(dir));
    }

    private static void Capture(string path, string? step)
    {
        using var form = new SetupForm();
        form.Show();
        Application.DoEvents();
        form.PerformLayout();
        if (!string.IsNullOrEmpty(step)) form.PreviewState(step);
        Application.DoEvents();
        Thread.Sleep(150);
        Application.DoEvents();

        var size = form.ClientSize;
        using var bmp = new System.Drawing.Bitmap(size.Width, size.Height);
        form.DrawToBitmap(bmp, new System.Drawing.Rectangle(0, 0, size.Width, size.Height));
        bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        form.Hide();
    }

    private static string? Arg(string[] args, string prefix) =>
        args.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))?[prefix.Length..];

    private static int Silent(string[] args)
    {
        var dir = Arg(args, "--dir=");
        dir = string.IsNullOrWhiteSpace(dir) ? Payload.DefaultDir : SetupForm.WithAppFolder(dir);
        var logPath = Arg(args, "--log=");
        void Log(string line)
        {
            if (string.IsNullOrEmpty(logPath)) return;
            try { File.AppendAllText(logPath, line + Environment.NewLine, new System.Text.UTF8Encoding(true)); } catch { /* ignore */ }
        }

        try
        {
            Log($"install -> {dir} ({Payload.TotalBytes} bytes)");
            Payload.InstallAsync(dir, (pct, name) => { if (pct % 20 == 0) Log($"  {pct}% {name}"); })
                .GetAwaiter().GetResult();
            Payload.CreateUninstaller(dir);
            Payload.CreateShortcuts(dir, true);
            Payload.Register(dir);
            Log("ok");
            return 0;
        }
        catch (Exception ex)
        {
            Log("failed: " + ex);
            return 1;
        }
    }
}
