using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace ikuyoMail;

/// <summary>
/// 「另存为 PDF」的自检入口（开发用）：
///   ikuyoMail.exe --pdf-test=http://127.0.0.1:7317/print.html?acc=..&amp;folder=INBOX&amp;uid=1|D:\out.pdf
/// 走的是和右键菜单完全相同的排版页与打印参数，把结果写到 out.pdf.result.txt 后退出。
/// 需要一个正在运行的本地服务（先开一次程序即可）。
/// </summary>
internal sealed class PrintProbeForm : Form
{
    private readonly string _url;
    private readonly string _outPath;

    public PrintProbeForm(string arg)
    {
        var parts = arg.Split('|');
        _url = parts[0];
        _outPath = parts.Length > 1 && parts[1].Trim().Length > 0
            ? parts[1].Trim()
            : Path.Combine(Path.GetTempPath(), "ikuyo-mail-test.pdf");

        Text = "ikuyoMail PDF 自检";
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(-32000, -32000, 400, 300);
        Load += async (_, _) => await RunAsync();
    }

    private async Task RunAsync()
    {
        var ok = false;
        var error = "";
        long size = 0;
        try
        {
            var dataDir = Path.Combine(AppContext.BaseDirectory, "data", "webview2");
            Directory.CreateDirectory(dataDir);
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            ok = await EmailPrinter.PrintAsync(env, _url, _outPath);
            if (File.Exists(_outPath)) size = new FileInfo(_outPath).Length;
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        try
        {
            File.WriteAllText(
                _outPath + ".result.txt",
                $"ok={ok}\nfile={_outPath}\nexists={File.Exists(_outPath)}\nsize={size}\nerror={error}\n");
        }
        catch
        {
            /* ignore */
        }
        Close();
    }
}
