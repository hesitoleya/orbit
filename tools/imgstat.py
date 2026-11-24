import sys
from PIL import Image

for p in sys.argv[1:]:
    im = Image.open(p).convert('L')
    w, h = im.size
    px = im.load()
    regions = [('top', 0, int(h * 0.45)), ('mid', int(h * 0.35), int(h * 0.75)), ('all', 0, h)]
    row = [p.split('/')[-1]]
    for name, y0, y1 in regions:
        s = n = hi = 0
        for y in range(y0, y1, 3):
            for x in range(0, w, 3):
                v = px[x, y]
                s += v; n += 1
                if v > 200:
                    hi += 1
        row.append('%s mean=%.1f sat=%.1f%%' % (name, s / n, hi / n * 100))
    print(' | '.join(row))
