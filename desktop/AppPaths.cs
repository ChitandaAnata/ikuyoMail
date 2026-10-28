using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ikuyoMail;

/// <summary>
/// 程序目录的定位、运行时文件的放置，以及「是不是已经有窗口在跑」的判定。
/// 放在这里是为了让 MainForm 和 Program 用同一套规则。
/// </summary>
internal static class AppPaths
{
    private static string? _root;

    /// <summary>安装目录：src/server.js 所在的那一层。找不到就返回空串</summary>
    public static string Root()
    {
        if (_root is null)
        {
            var found = "";
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            for (var i = 0; i < 6 && dir is not null; i++)
            {
                if (File.Exists(Path.Combine(dir.FullName, "src", "server.js")))
                {
                    found = dir.FullName;
                    break;
                }
                dir = dir.Parent;
            }
            _root = found;
        }
        return _root;
    }

    /// <summary>找不到安装目录时退回 exe 自己所在的那一层，至少不会抛异常</summary>
    public static string RootOrExeDir()
    {
        var root = Root();
        return root.Length > 0 ? root : AppContext.BaseDirectory.TrimEnd('\\');
    }

    public static string DataDir => Path.Combine(RootOrExeDir(), "data");

    /// <summary>第二个实例写给第一个实例的「纸条」</summary>
    public static string RouteFile => Path.Combine(DataDir, "route.txt");

    /// <summary>启动日志：出问题的时候先看这里</summary>
    public static string LogFile => Path.Combine(DataDir, "startup.log");

    /// <summary>本实例的运行标记（pid + 心跳），别人靠它判断「是不是真有一份还活着」</summary>
    public static string InstanceFile => Path.Combine(DataDir, "instance.json");

    /// <summary>
    /// 单实例锁的名字带上目录摘要：只有「同一个目录里的同一份程序」才算重复启动。
    /// 装在别处的另一份 ikuyoMail 应当能自己开自己的窗口。
    /// </summary>
    public static string MutexName => "ikuyoMail.instance." + ShortHash(RootOrExeDir());

    private static string ShortHash(string s)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(s.TrimEnd('\\').ToLowerInvariant()));
        return Convert.ToHexString(bytes, 0, 6).ToLowerInvariant();
    }

    public static void EnsureDataDir()
    {
        Directory.CreateDirectory(DataDir);
    }
}

/// <summary>instance.json 的读写：pid、exe 路径、心跳时间</summary>
internal sealed class InstanceMark
{
    public int Pid { get; set; }
    public string Exe { get; set; } = "";
    public DateTimeOffset Beat { get; set; }

    public static void Write()
    {
        try
        {
            AppPaths.EnsureDataDir();
            var mark = new InstanceMark
            {
                Pid = Environment.ProcessId,
                Exe = Application.ExecutablePath,
                Beat = DateTimeOffset.UtcNow,
            };
            File.WriteAllText(AppPaths.InstanceFile, JsonSerializer.Serialize(mark));
        }
        catch
        {
            /* 写不了标记不影响跑，只影响别人能不能认出你 */
        }
    }

    public static void Remove()
    {
        try
        {
            File.Delete(AppPaths.InstanceFile);
        }
        catch
        {
            /* ignore */
        }
    }

    /// <summary>
    /// 已有的运行标记是不是还活着：进程存在、指向同一份 exe、而且心跳在 15 秒内。
    /// 卡死/已被强杀的旧进程认不出来，新进程可以直接顶上。
    /// </summary>
    public static bool Alive()
    {
        try
        {
            var path = AppPaths.InstanceFile;
            if (!File.Exists(path)) return false;
            var mark = JsonSerializer.Deserialize<InstanceMark>(File.ReadAllText(path));
            if (mark is null) return false;

            Process proc;
            try
            {
                proc = Process.GetProcessById(mark.Pid);
            }
            catch
            {
                return false;
            }
            if (proc.HasExited) return false;

            var mine = Application.ExecutablePath;
            if (mark.Exe.Length > 0 && mine.Length > 0 &&
                !string.Equals(mark.Exe, mine, StringComparison.OrdinalIgnoreCase))
                return false;   // 是别的目录里那份程序的标记，跟这里无关

            if (mark.Beat == default)
                return DateTimeOffset.UtcNow - File.GetLastWriteTimeUtc(path) < TimeSpan.FromSeconds(15);
            return DateTimeOffset.UtcNow - mark.Beat < TimeSpan.FromSeconds(15);
        }
        catch
        {
            return false;
        }
    }
}
