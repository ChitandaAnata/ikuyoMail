using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ikuyoMail;

/// <summary>
/// 用屏幕外的 WebView2 把「单封邮件排版页」打印成 A4 PDF。
/// 主窗口和它的 WebView 完全不参与，用户看不到中间过程。
/// </summary>
internal static class EmailPrinter
{
    public static async Task<bool> PrintAsync(CoreWebView2Environment env, string url, string path)
    {
        // 屏幕外的小窗口：WebView2 需要真实窗口句柄才能渲染，但不需要让人看见
        var host = new Form
        {
            FormBorderStyle = FormBorderStyle.None,
            ShowInTaskbar = false,
            StartPosition = FormStartPosition.Manual,
            Bounds = new Rectangle(-32000, -32000, 900, 1300),
            BackColor = Color.White,
        };
        var view = new WebView2 { Dock = DockStyle.Fill };
        host.Controls.Add(view);
        host.Show();
        try
        {
            await view.EnsureCoreWebView2Async(env);
            var core = view.CoreWebView2;
            var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            core.WebMessageReceived += (_, e) =>
            {
                try
                {
                    // 页面在图片加载完、排版稳定后才发这条消息
                    if (e.WebMessageAsJson.Contains("print-ready")) ready.TrySetResult(true);
                }
                catch
                {
                    /* ignore */
                }
            };
            core.Navigate(url);

            var done = await Task.WhenAny(ready.Task, Task.Delay(25000));
            if (done != ready.Task) return false;

            var settings = core.Environment.CreatePrintSettings();
            settings.PageWidth = 8.27;   // A4，单位英寸
            settings.PageHeight = 11.69;
            settings.MarginTop = 0.35;
            settings.MarginBottom = 0.35;
            settings.MarginLeft = 0.35;
            settings.MarginRight = 0.35;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;
            return await core.PrintToPdfAsync(path, settings);
        }
        finally
        {
            try
            {
                host.Close();
            }
            catch
            {
                /* ignore */
            }
            host.Dispose();
        }
    }
}
