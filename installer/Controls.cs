using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace ikuyoMail.Setup;

/// <summary>圆角按钮：主按钮填主色，次按钮白底细边</summary>
internal sealed class FlatButton : Control
{
    private bool _hover;
    private bool _down;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Primary { get; set; } = true;

    public FlatButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;
        Font = Theme.Button;
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hover = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hover = false;
        _down = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            _down = true;
            Invalidate();
        }
        base.OnMouseDown(e);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        _down = false;
        Invalidate();
        base.OnMouseUp(e);
    }

    protected override void OnEnabledChanged(EventArgs e)
    {
        Cursor = Enabled ? Cursors.Hand : Cursors.Default;
        Invalidate();
        base.OnEnabledChanged(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var k = DeviceDpi / 96f;
        var rect = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
        using var path = Theme.Round(rect, 8f * k);

        Color fill, border, ink;
        if (!Enabled)
        {
            fill = Theme.FromHex("#F4F3F5");
            border = fill;
            ink = Theme.Muted;
        }
        else if (Primary)
        {
            fill = _down ? Theme.AccentDown : _hover ? Theme.AccentHover : Theme.Accent;
            border = fill;
            ink = Color.White;
        }
        else
        {
            fill = _down ? Theme.FromHex("#F2F1F4") : _hover ? Theme.FromHex("#FAF9FB") : Color.White;
            border = _hover ? Theme.FromHex("#DCDBE1") : Theme.Line;
            ink = Theme.Ink2;
        }

        using (var b = new SolidBrush(fill)) g.FillPath(b, path);
        using (var p = new Pen(border, 1f)) g.DrawPath(p, path);
        TextRenderer.DrawText(g, Text, Font, Rectangle.Round(rect), ink,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
    }
}

/// <summary>扁平复选框，整行可点</summary>
internal sealed class FlatCheck : Control
{
    private bool _checked;
    private bool _hover;

    public event EventHandler? CheckedChanged;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public bool Checked
    {
        get => _checked;
        set
        {
            if (_checked == value) return;
            _checked = value;
            Invalidate();
            CheckedChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public FlatCheck()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;
        Font = Theme.Body;
        Cursor = Cursors.Hand;
    }

    protected override void OnClick(EventArgs e)
    {
        Checked = !Checked;
        base.OnClick(e);
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hover = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hover = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var k = DeviceDpi / 96f;
        var side = 18f * k;
        var box = new RectangleF(0.5f, (Height - side) / 2f, side, side);
        using var path = Theme.Round(box, 5f * k);

        var fill = _checked ? Theme.Accent : Color.White;
        if (!_checked && _hover) fill = Theme.FromHex("#FBFAFC");
        using (var b = new SolidBrush(fill)) g.FillPath(b, path);
        using (var p = new Pen(_checked ? Theme.Accent : Theme.FromHex("#D6D5DB"), 1.2f)) g.DrawPath(p, path);

        if (_checked)
        {
            using var pen = new Pen(Color.White, Math.Max(1.6f, 1.6f * k))
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round,
            };
            var pts = new[]
            {
                new PointF(box.X + side * 0.26f, box.Y + side * 0.53f),
                new PointF(box.X + side * 0.44f, box.Y + side * 0.71f),
                new PointF(box.X + side * 0.76f, box.Y + side * 0.31f),
            };
            g.DrawLines(pen, pts);
        }

        var textRect = new Rectangle((int)(side + 10 * k), 0, Width - (int)(side + 10 * k), Height);
        TextRenderer.DrawText(g, Text, Font, textRect, Theme.Ink2,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding |
            TextFormatFlags.EndEllipsis);
    }
}

/// <summary>带圆角边框的输入框（里面是一个无边框 TextBox）</summary>
internal sealed class FlatInput : Control
{
    public readonly TextBox Box = new();

    public FlatInput()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;

        Box.BorderStyle = BorderStyle.None;
        Box.Font = Theme.Body;
        Box.BackColor = Color.White;
        Box.ForeColor = Theme.Ink;
        Box.Enter += (_, _) => Invalidate();
        Box.Leave += (_, _) => Invalidate();
        Controls.Add(Box);
    }

    public override string? Text
    {
        get => Box.Text;
        set => Box.Text = value ?? "";
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        var k = DeviceDpi / 96f;
        var pad = (int)Math.Round(12 * k);
        var h = Box.PreferredHeight;
        Box.SetBounds(pad, (Height - h) / 2, Math.Max(10, Width - pad * 2), h);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var k = DeviceDpi / 96f;
        var rect = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
        using var path = Theme.Round(rect, 9f * k);
        using (var b = new SolidBrush(Color.White)) g.FillPath(b, path);
        var focused = Box.Focused;
        using var pen = new Pen(focused ? Theme.Accent : Theme.FromHex("#DFDEE4"), focused ? 1.5f : 1f);
        g.DrawPath(pen, path);
        if (focused)
        {
            // 焦点时补一圈很淡的主色描边，和页面里的输入框呼应
            using var glow = new Pen(Color.FromArgb(36, Theme.Accent), 2.5f * k);
            g.DrawPath(glow, path);
        }
    }
}

/// <summary>细长进度条</summary>
internal sealed class FlatProgress : Control
{
    private int _percent;

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public int Percent
    {
        get => _percent;
        set
        {
            var v = Math.Max(0, Math.Min(100, value));
            if (v == _percent) return;
            _percent = v;
            Invalidate();
        }
    }

    public FlatProgress()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var k = DeviceDpi / 96f;
        var h = Math.Max(4f, 6f * k);
        var track = new RectangleF(0, (Height - h) / 2f, Width, h);
        using (var path = Theme.Round(track, h / 2f))
        using (var b = new SolidBrush(Theme.Track))
            g.FillPath(b, path);

        var w = Width * (_percent / 100f);
        if (w < 1f) return;
        var fill = new RectangleF(0, (Height - h) / 2f, Math.Max(w, h), h);
        using (var path = Theme.Round(fill, h / 2f))
        using (var b = new SolidBrush(Theme.Accent))
            g.FillPath(b, path);
    }
}

/// <summary>右上角的关闭按钮</summary>
internal sealed class FlatCloseButton : Control
{
    private bool _hover;

    public FlatCloseButton()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Color.White;
        Cursor = Cursors.Hand;
        TabStop = false;
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hover = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hover = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var k = DeviceDpi / 96f;
        if (_hover)
        {
            using var path = Theme.Round(new RectangleF(0, 0, Width, Height), 7f * k);
            using var b = new SolidBrush(Theme.FromHex("#F3F2F5"));
            g.FillPath(b, path);
        }
        var pad = 9 * k;
        using var pen = new Pen(_hover ? Theme.Ink : Theme.FromHex("#8B8A90"), Math.Max(1.2f, 1.2f * k))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
        };
        g.DrawLine(pen, pad, pad, Width - pad, Height - pad);
        g.DrawLine(pen, Width - pad, pad, pad, Height - pad);
    }
}
