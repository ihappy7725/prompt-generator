"""로고 PNG의 단색 배경을 지워 투명하게 만듭니다.

    python tools/make_transparent.py 원본.png 결과.png [허용오차] [경계폭]

네 모서리 색을 배경색으로 보고, 그 색과 얼마나 다른지로 투명도를 정합니다.
글자 가장자리처럼 배경과 반쯤 섞인 곳은 반투명으로 남기고, 섞인 배경색을
빼내서(언프리멀티플라이) 흰 배경에 올려도 테두리가 지저분해지지 않게 합니다.
"""
import sys
from PIL import Image


def background_color(px, w, h):
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    return tuple(sum(c[i] for c in corners) // len(corners) for i in range(3))


def make_transparent(src, dst, tol=42, soft=120):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = background_color(px, w, h)

    out = Image.new("RGBA", (w, h))
    op = out.load()
    span = max(soft - tol, 1)
    cleared = 0
    partial = 0

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if d <= tol:
                op[x, y] = (0, 0, 0, 0)
                cleared += 1
                continue
            alpha = 255 if d >= soft else int(255 * (d - tol) / span)
            if alpha < 255:
                partial += 1
            af = alpha / 255.0
            # 배경이 섞여 들어간 만큼 빼낸다
            nr = int((r - bg[0] * (1 - af)) / af)
            ng = int((g - bg[1] * (1 - af)) / af)
            nb = int((b - bg[2] * (1 - af)) / af)
            clamp = lambda v: 0 if v < 0 else (255 if v > 255 else v)
            op[x, y] = (clamp(nr), clamp(ng), clamp(nb), min(alpha, a))

    out.save(dst)
    total = w * h
    print("%s -> %s" % (src, dst))
    print("  크기 %dx%d / 배경색 #%02x%02x%02x" % (w, h, bg[0], bg[1], bg[2]))
    print("  완전 투명 %.1f%% / 반투명 가장자리 %d픽셀" % (cleared * 100.0 / total, partial))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    tol = int(sys.argv[3]) if len(sys.argv) > 3 else 42
    soft = int(sys.argv[4]) if len(sys.argv) > 4 else 120
    make_transparent(sys.argv[1], sys.argv[2], tol, soft)
