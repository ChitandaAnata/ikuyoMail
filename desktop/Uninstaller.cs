using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace ikuyoMail;

/// <summary>
/// 卸载入口。安装目录里的 `Uninstall.exe` 就是 ikuyoMail.exe 本身（硬链接），
/// 点它或者在「应用和功能」里点卸载，都会走到这里。
///
/// 自己删不掉自己，所以先把 exe 复制一份到 %TEMP%，由副本负责整个删除过程，
/// 这样安装目录里一个文件都不会剩下。
/// </summary>
internal static class Uninstaller
{
    public static void Run(string[] args)
    {
        var silent = args.Any(a =>
            a.Equals("/S", StringComparison.OrdinalIgnoreCase) ||
            a.Equals("--silent", StringComparison.OrdinalIgnoreCase));
        // 静默卸载默认保留 data；带 --purge 就连账号一起删（给脚本和测试用）
        var purge = args.Any(a => a.Equals("--purge", StringComparison.OrdinalIgnoreCase));

        // 副本会带上 --dir=，指明到底要删哪个目录
        var dir = (ArgValue(args, "--dir=") ?? AppContext.BaseDirectory)
            .Trim()
            .Trim('"')
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (dir.Length == 0) return;

        if (!args.Any(a => a.Equals("--from-temp", StringComparison.OrdinalIgnoreCase)))
        {
            if (SpawnCopy(dir, silent, purge)) return;
            // 复制失败（比如没有写临时目录的权限）就在原地干活，剩下的交给收尾批处理
        }

        if (silent)
        {
            var keepData = !purge;
            UninstallJob.Run(dir, keepData, (_, _) => { });
            UninstallJob.ScheduleCleanup(dir, keepData, true);
            return;
        }

        Application.Run(new UninstallForm(dir));
    }

    /// <summary>把自己复制到临时目录再跑一遍；成功返回 true</summary>
    private static bool SpawnCopy(string dir, bool silent, bool purge)
    {
        try
        {
            // 顺手清掉上次遗留的副本（进程还活着的删不掉，忽略即可）
            foreach (var old in Directory.GetFiles(Path.GetTempPath(), "ikuyoMail-uninstall-*.exe"))
            {
                try { File.Delete(old); } catch { /* 还在用 */ }
            }

            var temp = Path.Combine(Path.GetTempPath(), $"ikuyoMail-uninstall-{Guid.NewGuid():N}.exe");
            File.Copy(Application.ExecutablePath, temp, true);

            var arguments = $"--uninstall --from-temp --dir=\"{dir}\"" + (silent ? " /S" : "") + (purge ? " --purge" : "");
            var psi = new ProcessStartInfo(temp, arguments)
            {
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(temp) ?? Path.GetTempPath(),
            };
            var p = Process.Start(psi);
            return p is not null;
        }
        catch
        {
            return false;
        }
    }

    private static string? ArgValue(string[] args, string prefix) =>
        args.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            ?.Substring(prefix.Length);
}
