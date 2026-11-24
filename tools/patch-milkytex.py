import io, sys
p = 'public/js/app.js'
src = open(p, encoding='utf-8').read()
key = 'function makeGalaxyTex() {'
i = src.index(key)
j = i + len(key)
depth = 1
while depth > 0:
    ch = src[j]
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
    j += 1
new = """function makeGalaxyTex() {
  /* Dialogue 137: real Milky Way edge-on view (ESO, CC BY 4.0), replacing the
     procedural fbm disc. Image loads async; needsUpdate fires on onload. */
  const img = new Image();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  img.onload = () => { tex.needsUpdate = true; };
  img.src = 'data:image/jpeg;base64,' + MW_B64;
  return tex;
}"""
src = src[:i] + new + src[j:]
open(p, 'w', encoding='utf-8').write(src)
print('patched: old', j - i, 'new', len(new))
