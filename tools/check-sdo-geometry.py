"""SDO 日面与日冕离线材质验证；不创建浏览器、不启动 HTTP 服务。"""
from array import array
from pathlib import Path
from math import sin, cos, pi, sqrt, radians
import ast
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/.reference-python'))
import moderngl as gl
from PIL import Image, ImageDraw, ImageFont

JS = (ROOT / 'public/js/app.js').read_text(encoding='utf8')
POSTER = ROOT / 'public/data/sdo-poster.jpg'
OUT = ROOT / 'docs/sdo-3d-check.png'
S = 560
EXTENT = 1.32

def material(block, stage):
    src = re.search(r'\b' + stage + r'Shader:\s*(\[.*?\]\.join\([^)]*\)|`[^`]*`)', block, re.S)[1]
    shared = re.search(r'const sdoProjection\s*=\s*`(.*?)`', JS, re.S)[1]
    if src.startswith('`'):
        src = src[1:-1].replace('${sdoProjection}', shared)
    else:
        lines = []
        for line in src[:src.rindex(']')].splitlines()[1:]:
            line = line.strip()
            if line.startswith("'"):
                lines.append(ast.literal_eval(re.match(r"'(?:\\.|[^'\\])*'", line)[0]))
            elif line.startswith('sdoProjection'):
                lines.append(shared)
            elif line and not line.startswith('//'):
                raise ValueError(line)
        src = '\n'.join(lines)
    # 在缩放至单位半径的离线线性 HDR 色缓冲里不需要 three 的对数深度或画布专用输出块。
    src = re.sub(r'#include\s*<(common|logdepthbuf_\w+|colorspace_fragment|tonemapping_fragment)>', '', src)
    src = re.sub(r'precision\s+\w+\s+float\s*;', '', src)
    src = src.replace('texture2DGradEXT', 'textureGrad').replace('texture2D(', 'texture(')
    if stage == 'vertex':
        pre = 'in vec3 position, normal; uniform mat4 modelViewMatrix, projectionMatrix, modelMatrix; uniform mat3 normalMatrix; uniform vec3 cameraPosition;'
        src = src.replace('varying ', 'out ')
    else:
        pre = 'out vec4 outputColor;'
        src = src.replace('varying ', 'in ').replace('gl_FragColor', 'outputColor')
    return '#version 330\n' + pre + '\n' + src

def sphere(ctx, prog, radius, nx, ny):
    v, ids = array('f'), array('I')
    for i in range(ny + 1):
        t = pi*i/ny
        for j in range(nx + 1):
            a = 2*pi*j/nx
            n = (-cos(a)*sin(t), cos(t), sin(a)*sin(t))
            v.extend(k*radius for k in n)
            if 'normal' in prog:
                v.extend(n)
    for i in range(ny):
        for j in range(nx):
            b = i*(nx+1)+j; a = b+1; c = b+nx+1; d = c+1
            if i: ids.extend((a,b,d))
            if i != ny-1: ids.extend((b,c,d))
    args = ('3f 3f','position','normal') if 'normal' in prog else ('3f','position')
    return ctx.vertex_array(prog, [(ctx.buffer(v), *args)], ctx.buffer(ids))

def matrix(p, key, rows):
    if key in p:
        p[key].write(array('f', (x for col in zip(*rows) for x in col)))

def put(p, key, value):
    if key in p: p[key].value = value

def text(draw, xy, msg, size, color):
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)
    draw.text(xy, msg, font=font, fill=color)

def compare_core(frame, poster):
    # 正面北半球前侧为原始观测投影；独立按球面坐标取参考帧的双线性像素。
    # 只比较实际合成结果，不对参考样本做视角调光补偿。
    num = r'([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?)'
    vec = r'vec2\(\s*' + num + r'\s*,\s*' + num + r'\s*\)'
    affine = re.search(r'\bsdoUV\s*\(vec2 xy\)\s*\{\s*return\s+' + vec + r'\s*\+\s*' + vec + r'\s*\*\s*xy\s*;', JS)
    if affine is None: raise ValueError('需检查应用中 sdoUV 的投影表达式，不能沿用旧拟合参数')
    cx,cy,rx,ry = map(float,affine.groups())
    print('海报归一化拟合 (cx, cy, rx, ry):', (cx,cy,rx,ry))
    pix = poster.load(); result = frame.load(); w,h = poster.size
    sa = sb = saa = sbb = sab = err = count = 0
    for j in range(2, S, 3):
        y = (1 - 2*(j+.5)/S)*EXTENT
        for i in range(2, S, 3):
            x = (2*(i+.5)/S - 1)*EXTENT
            if not (.15 < y < .72 and x*x+y*y < .75**2): continue
            fx = (cx+rx*x)*w-.5; fy = (1-cy-ry*y)*h-.5
            ix, iy = int(fx), int(fy); u, v = fx-ix, fy-iy
            ref = [sum(pix[ix+dx,iy+dy][k]*wx*wy for dx,wx in enumerate((1-u,u)) for dy,wy in enumerate((1-v,v))) for k in range(3)]
            got = result[i,j]; err += sum(abs(a-b) for a,b in zip(ref,got))/3
            a = sum(k*v for k,v in zip((.2126,.7152,.0722),ref)); b = sum(k*v for k,v in zip((.2126,.7152,.0722),got))
            sa+=a; sb+=b; saa+=a*a; sbb+=b*b; sab+=a*b; count+=1
    return count, err/count, (sab-sa*sb/count)/sqrt((saa-sa*sa/count)*(sbb-sb*sb/count))

def display(fbo):
    # PNG 为显示编码 sRGB，不包含浏览器的光晕、自动曝光、调色与 UI。
    rgb = array('f'); rgb.frombytes(fbo.read(components=3, dtype='f4'))
    def pixel(c):
        c = min(1., max(c, 0.)); return round(255*(12.92*c if c<=.0031308 else 1.055*c**(1/2.4)-.055))
    return Image.frombytes('RGB', (S,S), bytes(pixel(c) for c in rgb)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)

def contact(front, side, stats):
    w,h = S*2 + 72, S+169
    out = Image.new('RGB', (w,h), (14,18,24)); draw = ImageDraw.Draw(out)
    text(draw,(24,13),'太阳局部观测投影  /  离线材质检查',26,'#f3f0ec')
    text(draw,(24,58),'01   正面 · 沿观测轴',17,'#cbd3d5'); text(draw,(48+S,58),'02   侧面 · 绕日心转 90°',17,'#cbd3d5')
    out.paste(front,(24,91)); out.paste(side,(48+S,91))
    text(draw,(24,S+103),'实际球面与日冕着色器 · 输入 SDO 海报 · 未观测区域为纹理延展，并非多视角实拍。',17,'#cbd3d5')
    text(draw,(24,S+132),f'正面观测区 / {stats[0]} 个采样点，RGB 平均绝对差 {stats[1]:.2f}/255 · 不含浏览器合成或视频播放。',15,'#a5afb7')
    out.save(OUT)

def main():
    ctx = gl.create_standalone_context(require=330)
    surface = JS.split('const sunMesh =',1)[1].split('scene.add(sunMesh)',1)[0]
    shell = JS.split('const sdoCorona =',1)[1].split('sdoCorona.scale',1)[0]
    mats = []
    for block in (surface,shell):
        p = ctx.program(vertex_shader=material(block,'vertex'),fragment_shader=material(block,'fragment'))
        r,nx,ny = re.search(r'SphereGeometry\(\s*([\w.]+),\s*(\d+),\s*(\d+)', block).groups()
        mats.append((p,sphere(ctx,p,1 if r=='R_SUN' else float(r),int(nx),int(ny))))
    poster = Image.open(POSTER).convert('RGB')
    t = ctx.texture(poster.size,3,poster.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes(),alignment=1)
    t.build_mipmaps(); t.filter = gl.LINEAR_MIPMAP_LINEAR,gl.LINEAR; t.repeat_x=t.repeat_y=False; t.use(0)
    base_img = Image.open(ROOT / 'public/data/sun-emission-4k.jpg').convert('RGB')
    # 应用中的底图不翻转，sRGB 在线性采样前由硬件解码。
    base = ctx.texture(base_img.size,3,base_img.tobytes(),alignment=1,internal_format=0x8C41)
    base.build_mipmaps(); base.filter=gl.LINEAR_MIPMAP_LINEAR,gl.LINEAR; base.repeat_x=True; base.repeat_y=False; base.use(1)
    fbo = ctx.framebuffer(ctx.texture((S,S),4,dtype='f2'),ctx.depth_renderbuffer((S,S))); fbo.use()
    ctx.viewport=(0,0,S,S); ctx.enable(gl.DEPTH_TEST | gl.CULL_FACE); ctx.cull_face='back'
    frames=[]; coronadeltas=[]
    for angle in (0,90):
        fbo.depth_mask=True; fbo.clear(0,0,0,0,depth=1)
        a = radians(angle); c,s=cos(a),sin(a); dist=256
        rot = ((c,0,-s),(0,1,0),(s,0,c)); identity = ((1,0,0,0),(0,1,0,0),(0,0,1,0),(0,0,0,1))
        for idx,(p,vao) in enumerate(mats):
            matrix(p,'modelViewMatrix',(rot[0]+(0,),rot[1]+(0,),rot[2]+(-dist,),(0,0,0,1)))
            matrix(p,'projectionMatrix',((1/EXTENT,0,0,0),(0,1/EXTENT,0,0),(0,0,-1/dist,-1),(0,0,0,1)))
            matrix(p,'normalMatrix',rot); matrix(p,'modelMatrix',identity)
            put(p,'cameraPosition',(s*dist,0,c*dist)); put(p,'uSdoReady',1.0); put(p,'uSdoNear',1.0); put(p,'uSdo',0); put(p,'uSolarMap',1); put(p,'uSolarMapReady',1.0)
            if idx:
                ctx.enable(gl.BLEND); ctx.blend_func = gl.SRC_ALPHA, gl.ONE; fbo.depth_mask=False
            else: ctx.disable(gl.BLEND)
            vao.render()
            if idx==0: disk = display(fbo)
        frames.append(display(fbo))
        # 只数球缘外（半径 > 1.01 R）比孤立日面亮出至少两个 8 位码值的像素。
        dp = disk.load(); fp = frames[-1].load(); n=0
        for j in range(S):
            for i in range(S):
                r2=((2*(i+.5)/S-1)*EXTENT)**2 + ((2*(j+.5)/S-1)*EXTENT)**2
                if 1.01**2 < r2 < 1.24**2 and max(b-a for a,b in zip(dp[i,j],fp[i,j]))>=2: n+=1
        coronadeltas.append(n)
    stats=compare_core(frames[0],poster)
    if not all(coronadeltas) or stats[2]<.75 or frames[0].tobytes()==frames[1].tobytes():
        raise ValueError(f'geometry or image check failed: {stats}, {coronadeltas}')
    contact(*frames, stats)
    print('renderer:',ctx.info['GL_RENDERER'],'poster:',poster.size,'frame:',S)
    print('samples, RGB MAE/255, luma Pearson:',stats,'off-limb shell pixels (+2 levels), front/side:',coronadeltas)
    print(OUT)

if __name__ == '__main__': main()
