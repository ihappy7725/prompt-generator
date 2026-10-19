"""투명 로고의 흰 글자만 다른 색으로 바꿉니다 (밝은 배경용 로고 만들기).

    python tools/recolor_wordmark.py 원본.png 결과.png #0f1b33 [글자시작x]

왼쪽 아이콘은 색이 진하고(채도 높음) 글자는 흰색(채도 0)이라서,
채도가 낮고 밝은 픽셀만 골라 색을 바꿉니다. 아이콘 영역은 건드리지 않도록
채도가 높은 구간이 끝나는 지점을 글자 시작 위치로 잡습니다.
"""
import sys
from PIL import Image


def saturation(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return 0 if mx == 0 else (mx - mn) / float(mx)


def find_text_start(px, w, h):
    """채도 높은 픽셀(아이콘)이 마지막으로 나오는 열 + 여백"""
    last = 0
    for x in range(int(w * 0.5)):
        for y in range(0, h, 2):
            r, g, b, a = px[x, y]
            if a > 40 and saturation(r, g, b) > 0.35:
                last = x
                break
    return last + 6


def recolor(src, dst, hexcolor, text_start=None):
    target = tuple(int(hexcolor.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    start = text_start if text_start is not None else find_text_start(px, w, h)

    changed = 0
    for y in range(h):
        for x in range(start, w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if saturation(r, g, b) < 0.22 and max(r, g, b) > 120:
                px[x, y] = (target[0], target[1], target[2], a)
                changed += 1

    im.save(dst)
    print("%s -> %s" % (src, dst))
    print("  글자 시작 x=%d / 색 바꾼 픽셀 %d개 / 새 색 #%02x%02x%02x"
          % (start, changed, target[0], target[1], target[2]))


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    start = int(sys.argv[4]) if len(sys.argv) > 4 else None
    recolor(sys.argv[1], sys.argv[2], sys.argv[3], start)
