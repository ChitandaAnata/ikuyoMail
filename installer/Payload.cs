using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace ikuyoMail.Setup;

/// <summary>解压程序文件、建快捷方式、写「应用和功能」条目</summary>
internal static class Payload
{
    public const string AppName = "ikuyoMail";
    public const string Version = "1.0.0";
    public const string ExeName = "ikuyoMail.exe";
    /// <summary>安装目录里的卸载程序：其实是 ikuyoMail.exe 的硬链接，不额外占空间</summary>
    public const string UninstallName = "Uninstall.exe";
    private const string RegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ikuyoMail";

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLinkW(string newLink, string existingFile, IntPtr security);

    public static string DefaultDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", AppName);

    private static long? _total;

    /// <summary>解压后要占多少字节（用于显示体积、检查磁盘空间）</summary>
    public static long TotalBytes
    {
        get
        {
            if (_total is { } known) return known;
            using var zip = OpenZip();
            _total = zip.Entries.Where(e => !IsDir(e)).Sum(e => e.Length);
            return _total.Value;
        }
    }

    public static string FormatSize(long bytes) =>
        bytes >= 1024L * 1024 * 1024
            ? (bytes / 1024d / 1024 / 1024).ToString("0.0") + " GB"
            : (bytes / 1024d / 1024).ToString("0") + " MB";

    private static ZipArchive OpenZip()
    {
        var asm = Assembly.GetExecutingAssembly();
        var stream = asm.GetManifestResourceStream("payload.zip")
                     ?? throw new InvalidOperationException("安装包里没有找到文件数据（payload.zip）。");
        return new ZipArchive(stream, ZipArchiveMode.Read);
    }

    private static bool IsDir(ZipArchiveEntry e) =>
        e.FullName.EndsWith("/", StringComparison.Ordinal) || e.FullName.EndsWith("\\", StringComparison.Ordinal);

    /// <summary>之前装过就返回安装目录（用于把路径框预填好）</summary>
    public static string? ExistingDir()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RegPath);
            var dir = key?.GetValue("InstallLocation") as string;
            if (!string.IsNullOrWhiteSpace(dir) && File.Exists(Path.Combine(dir, ExeName))) return dir;
        }
        catch
        {
            /* ignore */
        }
        return null;
    }

    public static bool HasEnoughSpace(string dir)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(dir));
            if (string.IsNullOrEmpty(root)) return true;
            var drive = new DriveInfo(root);
            return drive.AvailableFreeSpace > TotalBytes + 64L * 1024 * 1024;
        }
        catch
        {
            return true;
        }
    }

    /// <summary>把数据目录里的旧程序文件清掉（保留 data，免得把账号删了）</summary>
    private static void CleanOldFiles(string dir)
    {
        foreach (var name in new[] { "src", "public", "assets", "node_modules", "runtime" })
        {
            var path = Path.Combine(dir, name);
            try
            {
                if (Directory.Exists(path)) Directory.Delete(path, true);
            }
            catch
            {
                /* 删不掉就让解压覆盖 */
            }
        }
    }

    /// <summary>关掉还开着的 ikuyoMail 与它拉起的 node，否则文件被占用</summary>
    public static void StopRunning(string dir)
    {
        foreach (var p in Process.GetProcessesByName("ikuyoMail"))
        {
            try
            {
                // 只关这个目录里的那份；别的拷贝（比如开发目录）不动
                var exe = p.MainModule?.FileName ?? "";
                if (exe.Length == 0 || exe.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill(true);
            }
            catch
            {
                /* 关不掉就继续，解压时再说 */
            }
        }
        foreach (var p in Process.GetProcessesByName("node"))
        {
            try
            {
                var exe = p.MainModule?.FileName ?? "";
                if (exe.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) p.Kill(true);
            }
            catch { /* ignore */ }
        }
        Thread.Sleep(400);
    }

    public static async Task InstallAsync(
        string dir,
        Action<int, string> report,
        CancellationToken ct = default)
    {
        await Task.Run(() =>
        {
            Directory.CreateDirectory(dir);
            StopRunning(dir);
            CleanOldFiles(dir);

            using var zip = OpenZip();
            var total = Math.Max(1L, zip.Entries.Where(e => !IsDir(e)).Sum(e => e.Length));
            long done = 0;
            var lastReport = 0;

            foreach (var entry in zip.Entries)
            {
                ct.ThrowIfCancellationRequested();
                var relative = entry.FullName.Replace('\\', '/').TrimStart('/');
                if (relative.Length == 0) continue;
                var target = Path.Combine(dir, relative.Replace('/', Path.DirectorySeparatorChar));

                if (IsDir(entry))
                {
                    Directory.CreateDirectory(target);
                    continue;
                }

                var parent = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);

                using (var src = entry.Open())
                using (var dst = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                {
                    var buffer = new byte[1 << 16];
                    int read;
                    while ((read = src.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        ct.ThrowIfCancellationRequested();
                        dst.Write(buffer, 0, read);
                        done += read;
                        var pct = (int)(done * 100 / total);
                        var now = Environment.TickCount;
                        if (pct != lastReport && now - _lastTick > 45 || pct == 100)
                        {
                            _lastTick = now;
                            lastReport = pct;
                            report(pct, FriendlyName(relative));
                        }
                    }
                }
            }

            report(100, "正在创建快捷方式…");
        }, ct);
    }

    [ThreadStatic] private static int _lastTick;

    /// <summary>进度条上显示的名字：只说清楚正在装哪一类东西，不刷长路径</summary>
    private static string FriendlyName(string relative)
    {
        var parts = relative.Replace('\\', '/').Split('/');
        if (parts[0] == "node_modules")
            return parts.Length > 1 ? "依赖库 " + parts[1] : "依赖库";
        return parts[0] switch
        {
            "runtime" => "内置运行时",
            "src" => "服务端代码",
            "public" => "界面文件",
            "assets" => "辅助脚本",
            _ => parts[^1],
        };
    }

    /// <summary>
    /// 在安装目录里放一个 Uninstall.exe。用硬链接指向 ikuyoMail.exe：
    /// 同一个文件两个名字，不重复占磁盘，双击它就会走卸载流程。
    /// </summary>
    public static void CreateUninstaller(string dir)
    {
        var exe = Path.Combine(dir, ExeName);
        var link = Path.Combine(dir, UninstallName);
        try
        {
            if (File.Exists(link)) File.Delete(link);
        }
        catch
        {
            /* 删不掉就让下面覆盖 */
        }
        try
        {
            if (CreateHardLinkW(link, exe, IntPtr.Zero)) return;
        }
        catch
        {
            /* 不是 NTFS 就退回复制 */
        }
        try
        {
            File.Copy(exe, link, true);
        }
        catch
        {
            /* 建不出来也不影响主程序，只是少一个入口 */
        }
    }

    /// <summary>桌面 + 开始菜单快捷方式（用 WScript.Shell 建 .lnk，不依赖额外组件）</summary>
    public static void CreateShortcuts(string dir, bool desktop)
    {
        var exe = Path.Combine(dir, ExeName);
        var uninstall = Path.Combine(dir, UninstallName);
        if (!File.Exists(uninstall)) uninstall = exe;
        var startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            @"Microsoft\Windows\Start Menu\Programs", AppName);

        try
        {
            Directory.CreateDirectory(startMenu);
            MakeShortcut(Path.Combine(startMenu, AppName + ".lnk"), exe, dir, $"{AppName} —— 本地邮箱客户端");
            MakeShortcut(Path.Combine(startMenu, "卸载 " + AppName + ".lnk"), uninstall, dir,
                $"卸载 {AppName}");
        }
        catch
        {
            /* 快捷方式失败不算安装失败 */
        }

        if (!desktop) return;
        try
        {
            var link = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
            MakeShortcut(link, exe, dir, $"{AppName} —— 本地邮箱客户端");
        }
        catch
        {
            /* ignore */
        }
    }

    public static void RemoveDesktopShortcut()
    {
        try
        {
            var link = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
            if (File.Exists(link)) File.Delete(link);
        }
        catch
        {
            /* ignore */
        }
    }

    private static void MakeShortcut(string linkPath, string target, string workingDir, string description, string args = "")
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType is null) return;
        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic link = shell.CreateShortcut(linkPath);
        link.TargetPath = target;
        link.Arguments = args;
        link.WorkingDirectory = workingDir;
        link.IconLocation = target + ",0";
        link.Description = description;
        link.Save();
        Marshal.FinalReleaseComObject(link);
        Marshal.FinalReleaseComObject(shell);
    }

    /// <summary>写「设置 → 应用 → 已安装的应用」里的条目，卸载指向安装目录里的 Uninstall.exe</summary>
    public static void Register(string dir)
    {
        var exe = Path.Combine(dir, ExeName);
        var uninstall = Path.Combine(dir, UninstallName);
        if (!File.Exists(uninstall)) uninstall = exe;
        using var key = Registry.CurrentUser.CreateSubKey(RegPath, true);
        key.SetValue("DisplayName", AppName);
        key.SetValue("DisplayVersion", Version);
        key.SetValue("Publisher", AppName);
        key.SetValue("InstallLocation", dir);
        key.SetValue("DisplayIcon", exe + ",0");
        key.SetValue("UninstallString", $"\"{uninstall}\"");
        key.SetValue("QuietUninstallString", $"\"{uninstall}\" /S");
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        key.SetValue("EstimatedSize", (int)(TotalBytes / 1024), RegistryValueKind.DWord);
        try
        {
            key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"), RegistryValueKind.String);
        }
        catch
        {
            /* ignore */
        }
    }

    public static void Launch(string dir)
    {
        try
        {
            Process.Start(new ProcessStartInfo(Path.Combine(dir, ExeName))
            {
                WorkingDirectory = dir,
                UseShellExecute = true,
            });
        }
        catch
        {
            /* ignore */
        }
    }
}
