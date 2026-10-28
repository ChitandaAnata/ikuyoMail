using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace ikuyoMail.Setup;

/// <summary>配色与字体：跟程序本体一致的扁平风格，主色取自安装插画里的红</summary>
internal static class Theme
{
    public static readonly Color Accent = FromHex("#F0473A");
    public static readonly Color AccentHover = FromHex("#E23B2E");
    public static readonly Color AccentDown = FromHex("#C93227");
    public static readonly Color AccentSoft = FromHex("#FFF0ED");
    public static readonly Color Ink = FromHex("#1B1A1B");
    public static readonly Color Ink2 = FromHex("#6E6D73");
    public static readonly Color Muted = FromHex("#A3A2A8");
    public static readonly Color Line = FromHex("#E9E8EC");
    public static readonly Color LineSoft = FromHex("#F1F0F3");
    public static readonly Color Panel = FromHex("#FDF3F1");
    public static readonly Color Track = FromHex("#F0EFF3");
    public static readonly Color Ok = FromHex("#2E9E68");

    private static readonly string Family = PickFamily();

    private static string PickFamily()
    {
        foreach (var name in new[] { "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI" })
        {
            try
            {
                using var f = new FontFamily(name);
                return name;
            }
            catch
            {
                /* 换下一个 */
            }
        }
        return FontFamily.GenericSansSerif.Name;
    }

    public static Font Font(float size, FontStyle style = FontStyle.Regular) =>
        new(Family, size, style, GraphicsUnit.Point);

    public static readonly Font H1 = Font(19.5f, FontStyle.Bold);
    public static readonly Font H2 = Font(16f, FontStyle.Bold);
    public static readonly Font Body = Font(9.8f);
    public static readonly Font BodyStrong = Font(9.8f, FontStyle.Bold);
    public static readonly Font Small = Font(9f);
    public static readonly Font Tiny = Font(8.4f);
    public static readonly Font Wordmark = Font(16.5f, FontStyle.Bold);
    public static readonly Font Button = Font(10f);

    public static Color FromHex(string hex) => ColorTranslator.FromHtml(hex);

    public static GraphicsPath Round(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        var d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        if (d <= 0.5f)
        {
            path.AddRectangle(r);
            return path;
        }
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
