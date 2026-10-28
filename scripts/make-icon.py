"""
由原图生成 ikuyoMail 用到的图标资源（需 Pillow）。

    python scripts/make-icon.py "C:/path/to/source.png"

产出：
    public/icon-192.png  方形图标（侧栏品牌图 / 收藏夹大图）
    public/icon-64.png   方形图标（网页 favicon）
    assets/ikuyoMail.ico Windows 托盘 / 快捷方式图标（多尺寸）
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop" / "7f04ab5e-37fc-46fc-8dd5-c437868534d8.png"

# 原图里两个圆形头像重叠：右边那个是正脸，方形小图标取它更清楚
FACE_BOX = (95, 5, 265, 175)

im = Image.open(SRC).convert("RGBA")

# 方形图标（原图里两个圆形头像重叠，取右侧正脸那张，小尺寸下更清楚）
face = im.crop(FACE_BOX)
side = min(face.size)
face = face.crop(
    (
        (face.width - side) // 2,
        (face.height - side) // 2,
        (face.width - side) // 2 + side,
        (face.height - side) // 2 + side,
    )
)

# 四周留一点空隙，做成应用图标时不会顶到圆角边缘
PAD = 0.02
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
inner = int(round(side / (1 + PAD * 2)))
face = face.resize((inner, inner), Image.LANCZOS)
off = (side - inner) // 2
canvas.alpha_composite(face, (off, off))
face = canvas
face.resize((192, 192), Image.LANCZOS).save(ROOT / "public" / "icon-192.png", optimize=True)
face.resize((64, 64), Image.LANCZOS).save(ROOT / "public" / "icon-64.png", optimize=True)

# Windows 图标（ico 里塞多档尺寸，任务栏/托盘/资源管理器各取所需）
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
face.resize((256, 256), Image.LANCZOS).save(
    ROOT / "assets" / "ikuyoMail.ico", sizes=sizes, format="ICO"
)

print("icon-192.png", (ROOT / "public" / "icon-192.png").stat().st_size)
print("ikuyoMail.ico", (ROOT / "assets" / "ikuyoMail.ico").stat().st_size)
