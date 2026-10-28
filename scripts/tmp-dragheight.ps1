Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class DH {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool E(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(E cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static IntPtr Find() {
    IntPtr f = IntPtr.Zero;
    EnumWindows((h,l) => { if (!IsWindowVisible(h)) return true; var sb=new StringBuilder(300); GetWindowTextW(h,sb,300); if (sb.ToString()=="ikuyoMail") { f=h; return false; } return true; }, IntPtr.Zero);
    return f;
  }
}
"@
$h = [DH]::Find()
if ($h -eq [IntPtr]::Zero) { Write-Output '找不到窗口'; exit 1 }
$r = New-Object DH+RECT
[void][DH]::GetWindowRect($h, [ref]$r)
Write-Output ("初始 上 {0} 下 {1} 高 {2}" -f $r.Top, $r.Bottom, ($r.Bottom - $r.Top))
$cx = $r.Left + 300
$bottom0 = $r.Bottom
# 抓底边往上拖
[void][DH]::SetCursorPos($cx, $r.Bottom - 3)
Start-Sleep -Milliseconds 250
[DH]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 150
for ($step = 0; $step -le 460; $step += 40) {
  [void][DH]::SetCursorPos($cx, $bottom0 - 3 - $step)
  Start-Sleep -Milliseconds 90
  $rr = New-Object DH+RECT
  [void][DH]::GetWindowRect($h, [ref]$rr)
  Write-Output ("  上拖 {0}px → 上 {1} 下 {2} 高 {3}" -f $step, $rr.Top, $rr.Bottom, ($rr.Bottom - $rr.Top))
}
[DH]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 900
$rf = New-Object DH+RECT
[void][DH]::GetWindowRect($h, [ref]$rf)
$hf = $rf.Bottom - $rf.Top
Write-Output ("松手后 高 {0} | {1} | 上边缘位移 {2}" -f $hf, $(if ($hf -ge 490) {'高度 OK'} else {'高度 BAD'}), ($rf.Top - $r.Top))
