"""无窗口、无端口：用本机 ANGLE EGL 编译链接 Three 的实际着色器并读回像素。
Windows: py -3 tools/test-reference-deep-volume-egl.py [ANGLE的DLL目录]
"""
import ctypes as C
import json
import os
from pathlib import Path
import subprocess
import sys

here = Path(__file__).resolve().parent
evidence='--jpg' in sys.argv
side=400 if evidence else 64
m16='--m16' in sys.argv
args=[a for a in sys.argv[1:] if a not in ('--jpg','--m16')]
base = Path(args[0]) if args else next((Path(os.environ['LOCALAPPDATA'])/'Programs'/'Microsoft VS Code').glob('*/libEGL.dll')).parent
os.add_dll_directory(str(base))
e, g = (C.WinDLL(str(base / dll)) for dll in ('libEGL.dll','libGLESv2.dll'))
I, U, P, F, S = C.c_int, C.c_uint, C.c_void_p, C.c_float, C.c_char_p

def bind(lib, name, ret, *args):
    f = getattr(lib,name); f.restype = ret; f.argtypes = args
    return f

def egl(name, ret, *args): return bind(e,'egl'+name,ret,*args)
def gl(name, ret, *args): return bind(g,'gl'+name,ret,*args)
def ints(*v): return (I*len(v))(*v)
display=egl('GetDisplay',P,P)(None)
assert egl('Initialize',U,P,P,P)(display,None,None), 'EGL 初始化失败'
config=P(); count=I(); end=0x3038
assert egl('ChooseConfig',U,P,P,P,I,P)(display,ints(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3021,8,end),C.byref(config),1,C.byref(count)) and count.value
surf=egl('CreatePbufferSurface',P,P,P,P)(display,config,ints(0x3057,side,0x3056,side,end))
ctx=egl('CreateContext',P,P,P,P,P)(display,config,None,ints(0x3098,3,end))
assert egl('MakeCurrent',U,P,P,P,P)(display,surf,surf,ctx)
programs=json.loads(subprocess.check_output(['node',str(here/('test-m16-handoff.mjs' if m16 else 'test-reference-deep-volume.mjs')),'--shaders']))

def shader(kind,src):
    s=gl('CreateShader',U,U)(kind); b=S(src.encode()); gl('ShaderSource',None,U,I,P,P)(s,1,C.byref(b),None)
    gl('CompileShader',None,U)(s); ok=I();gl('GetShaderiv',None,U,U,P)(s,0x8b81,C.byref(ok))
    log=C.create_string_buffer(8192);gl('GetShaderInfoLog',None,U,I,P,P)(s,len(log),None,log)
    assert ok.value,log.value.decode();return s

def uni(p,k):return gl('GetUniformLocation',I,U,S)(p,k.encode())
def scalar(p,k,v): gl('Uniform1f',None,I,F)(uni(p,k),v)
def vec(p,k,x,y,z): gl('Uniform3f',None,I,F,F,F)(uni(p,k),x,y,z)
# 完整代理盒出口测试：正面 -Z、侧面 -X，正交投影。实际片元代码直接读取原色/消光纹理。
def render(p,side=False):
    ng=gl('GetAttribLocation',I,U,S)(p,b'position');verts=[]
    for x,y in [(-1,-1),(1,-1),(-1,1),(-1,1),(1,-1),(1,1)]: verts.extend((-1,y,x) if side else (x,y,-1))
    buf=U();gl('GenBuffers',None,I,P)(1,C.byref(buf));gl('BindBuffer',None,U,U)(0x8892,buf)
    gl('BufferData',None,U,C.c_ssize_t,P,U)(0x8892,len(verts)*4,(F*len(verts))(*verts),0x88e4)
    gl('EnableVertexAttribArray',None,U)(ng);gl('VertexAttribPointer',None,U,I,U,U,I,P)(ng,3,0x1406,0,0,None)
    mat=(F*16)(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)
    if side:mat=(F*16)(0,0,1,0,0,1,0,0,1,0,0,0,0,0,0,1)
    gl('UniformMatrix4fv',None,I,I,U,P)(uni(p,'modelViewMatrix'),1,0,mat)
    proj=(F*16)(1,0,0,0,0,1,0,0,0,0,.1,0,0,0,0,1)
    gl('UniformMatrix4fv',None,I,I,U,P)(uni(p,'projectionMatrix'),1,0,proj)
    vec(p,'uEye',4 if side else 0,0,0 if side else 4);vec(p,'uForward',-1 if side else 0,0,0 if side else -1)
    vec(p,'uViewZ',-1 if side else 0,0,0 if side else -1);vec(p,'uHalf',1,1,.6)
    for k,v in [('uOrtho',1),('uNear',.01),('uSteps',48),('uOpacity',1)]:scalar(p,k,v)
    gl('Uniform2f',None,I,F,F)(uni(p,'uPixels'),2,2)
    tex=U();gl('GenTextures',None,I,P)(1,C.byref(tex));gl('BindTexture',None,U,U)(0xde1,tex)
    pix=(C.c_ubyte*16)(190,25,18,255,35,64,190,255,140,20,26,255,16,96,200,255)
    gl('TexImage2D',None,U,I,I,I,I,I,U,U,P)(0xde1,0,0x1908,2,2,0,0x1908,0x1401,pix)
    gl('GenerateMipmap',None,U)(0xde1);gl('Viewport',None,I,I,I,I)(0,0,64,64)
    gl('ClearColor',None,F,F,F,F)(0,0,0,0);gl('Clear',None,U)(0x4000);gl('DrawArrays',None,U,I,I)(4,0,6)
    out=(C.c_ubyte*(64*64*4))();gl('ReadPixels',None,I,I,I,I,U,U,P)(0,0,64,64,0x1908,0x1401,out)
    assert gl('GetError',U)()==0
    gl('DeleteBuffers',None,I,P)(1,C.byref(buf));gl('DeleteTextures',None,I,P)(1,C.byref(tex));return bytes(out)

linked={}
for prog in programs:
    p=gl('CreateProgram',U)();v=shader(0x8b31,prog['vert']);f=shader(0x8b30,prog['frag'])
    for s in (v,f):gl('AttachShader',None,U,U)(p,s)
    gl('LinkProgram',None,U)(p);ok=I();gl('GetProgramiv',None,U,U,P)(p,0x8b82,C.byref(ok));assert ok.value,prog['name']
    if prog['name'].endswith('/Mesh'):
        gl('UseProgram',None,U)(p);a,b=render(p),render(p,True)
        assert sum(x>8 for x in a[3::4])>50 and sum(x>8 for x in b[3::4])>50,(prog['name'],'缺少侧向厚度')
        assert sum(abs(x-y) for x,y in zip(a,b))>10000,(prog['name'],'正侧视结果无差别')
    for s in (v,f):gl('DeleteShader',None,U)(s)
    if evidence or m16: linked[prog['name']]=p
    else: gl('DeleteProgram',None,U)(p)
if m16:
    # 使用真实片元程序和非均匀 3D 小场。原生跳过部分宏格，低层无跳步、细节和方向缓存。
    textures=[]
    for unit in range(8):
        target=0xde1 if unit==0 else 0x806f
        gl('ActiveTexture',None,U)(0x84c0+unit);tex=U();gl('GenTextures',None,I,P)(1,C.byref(tex));textures.append(tex)
        gl('BindTexture',None,U,U)(target,tex)
        for key in (0x2800,0x2801):gl('TexParameteri',None,U,U,I)(target,key,0x2600 if unit==4 else 0x2601)
        for key in (0x2802,0x2803,0x8072):gl('TexParameteri',None,U,U,I)(target,key,0x812f)
        if not unit:gl('TexImage2D',None,U,I,I,I,I,I,U,U,P)(target,0,0x8058,1,1,0,0x1908,0x1401,None);continue
        n=8;raw=[]
        for z in range(n):
            for y in range(n):
                for x in range(n):
                    v=(x*17+y*9+z*5+unit*7)%91
                    rgba=([0 if x<3 else 255]*4 if unit==4 else [v,100-v,25+v//2,12+v] if unit in (1,6) else [190-v,17+v,100+v,220])
                    raw.extend(rgba)
        gl('TexImage3D',None,U,I,I,I,I,I,I,U,U,P)(target,0,0x8058,n,n,n,0,0x1908,0x1401,(C.c_ubyte*len(raw))(*raw))
    def frame(blend,preview,w,eye):
        p=linked['volume-'+('blend' if blend else 'stable')];gl('UseProgram',None,U)(p)
        for unit,k in enumerate(('uOpaqueDepth','uCineDensity','uCineLight','uCineDetail','uCineOccupancy','uCineShading','uM16PreviewDensity','uM16PreviewLight')):
            gl('Uniform1i',None,I,I)(uni(p,k),unit+5 if preview and unit in (1,2) else unit)
        for k,v in {'uDepthEnabled':1,'uCineEnabled':1,'uGain':.75,'uLayerOpacity':1,'uCineSteps':320,'uCineSize':32 if preview else 256,'uCineStepFactor':.65,'uCineHasDetail':not preview,'uCineHasOccupancy':not preview,'uCineHasShading':not preview,'uCineFilteredShading':1,'uCineGrid':8,'uCineEmissionSqrt':1,'uCineEmissionScale':2,'uCineSigmaMax':2,'uCineLightScale':4,'uM16NativeWeight':w}.items():scalar(p,k,v)
        vec(p,'cameraPosition',eye,0,4);vec(p,'uCineLightPos',.2,.1,0);vec(p,'uCineAlbedo',.56,.40,.25)
        gl('Uniform2f',None,I,F,F)(uni(p,'uDepthSize'),32,32)
        ident=(F*16)(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)
        for k in ('modelMatrix','viewMatrix','projectionMatrix','uInverse'):gl('UniformMatrix4fv',None,I,I,U,P)(uni(p,k),1,0,ident)
        pos=gl('GetAttribLocation',I,U,S)(p,b'position');verts=(F*18)(-1,-1,0,1,-1,0,-1,1,0,-1,1,0,1,-1,0,1,1,0)
        buf=U();gl('GenBuffers',None,I,P)(1,C.byref(buf));gl('BindBuffer',None,U,U)(0x8892,buf);gl('BufferData',None,U,C.c_ssize_t,P,U)(0x8892,C.sizeof(verts),verts,0x88e4)
        gl('EnableVertexAttribArray',None,U)(pos);gl('VertexAttribPointer',None,U,I,U,U,I,P)(pos,3,0x1406,0,0,None)
        gl('Viewport',None,I,I,I,I)(0,0,32,32);gl('Clear',None,U)(0x4000);gl('DrawArrays',None,U,I,I)(4,0,6)
        out=(C.c_ubyte*4096)();gl('ReadPixels',None,I,I,I,I,U,U,P)(0,0,32,32,0x1908,0x1401,out);assert not gl('GetError',U)();gl('DeleteBuffers',None,I,P)(1,C.byref(buf));return bytes(out)
    for eye in (0,1.7):
        a,b=frame(False,True,0,eye),frame(False,False,1,eye)
        assert a==frame(True,False,0,eye) and b==frame(True,False,1,eye),'端点不等'
        for w in (.25,.5,.75):
            mid=frame(True,False,w,eye);diff=max(abs(m-(x*(1-w)+y*w)) for x,y,m in zip(a,b,mid));assert diff<=1.01,diff
        assert sum(abs(x-y) for x,y in zip(a,b))>4096
    for name,p in linked.items():
        count=I();gl('GetProgramiv',None,U,U,P)(p,0x8b86,C.byref(count));samplers=0
        for i in range(count.value):
            length,size,kind=I(),I(),U();key=C.create_string_buffer(128)
            gl('GetActiveUniform',None,U,U,I,P,P,P,P)(p,i,len(key),C.byref(length),C.byref(size),C.byref(kind),key)
            if kind.value in (0x8b5e,0x8b5f):samplers+=size.value
        assert samplers=={'volume-stable':6,'volume-blend':8,'stars-stable':1,'stars-blend':2}[name],(name,samplers)
        print(name,'active samplers:',samplers)
        if name.startswith('volume'):assert (uni(p,'uM16PreviewLight')>=0)==name.endswith('blend')
        gl('DeleteProgram',None,U)(p)
    print('PASS: 四个生产材质变体编译链接；两个视角 RGBA8 端点逐字节相等，三个中间权重误差不超过 1 级。');sys.exit(0)
print('PASS: 14 shader programs linked; 7 volume types rendered front/side with nonempty, distinct pixel readbacks.')

if evidence:
    print('GLES renderer:',gl('GetString',S,U)(0x1f01).decode())
    import math, tempfile
    sys.path.insert(0,str(here/'.reference-python'))
    from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageStat
    def texture(unit,img):
        gl('ActiveTexture',None,U)(0x84c0+unit)
        t=U();gl('GenTextures',None,I,P)(1,C.byref(t));gl('BindTexture',None,U,U)(0xde1,t)
        for key,val in [(0x2801,0x2703),(0x2800,0x2601),(0x2802,0x812f),(0x2803,0x812f)]: gl('TexParameteri',None,U,U,I)(0xde1,key,val)
        b=img.convert('RGBA').transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes();gl('TexImage2D',None,U,I,I,I,I,I,U,U,P)(0xde1,0,0x8c43,*img.size,0,0x1908,0x1401,b)
        gl('GenerateMipmap',None,U)(0xde1);return t
    def attr(p,key,n,vals):
        loc=gl('GetAttribLocation',I,U,S)(p,key.encode());buf=U();gl('GenBuffers',None,I,P)(1,C.byref(buf));gl('BindBuffer',None,U,U)(0x8892,buf)
        gl('BufferData',None,U,C.c_ssize_t,P,U)(0x8892,len(vals)*4,(F*len(vals))(*vals),0x88e4)
        gl('EnableVertexAttribArray',None,U)(loc);gl('VertexAttribPointer',None,U,I,U,U,I,P)(loc,n,0x1406,0,0,None);return loc,buf
    def draw_frame(id,d,cam):
        gl('Viewport',None,I,I,I,I)(0,0,side,side);gl('ClearColor',None,F,F,F,F)(0,0,0,1);gl('Clear',None,U)(0x4000)
        for mesh in [True,False]:
            stars=d['stars'];n=(len(d['tri']) if mesh else len(stars['position']))//3
            if not n: continue
            p=linked[id+('/Mesh' if mesh else '/Points')];gl('UseProgram',None,U)(p)
            gl('UniformMatrix4fv',None,I,I,U,P)(uni(p,'modelViewMatrix'),1,0,(F*16)(*cam['mv']));gl('UniformMatrix4fv',None,I,I,U,P)(uni(p,'projectionMatrix'),1,0,(F*16)(*cam['projection']))
            for k,v in [('uEye',cam['eye']),('uForward',cam['forward']),('uViewZ',cam['viewZ']),('uHalf',d['half'])]:vec(p,k,*v)
            for k,v in [('uNear',cam['near']),('uOrtho',0),('uPointScale',cam['pointScale']),('uPhotoLod',max(0,math.log2(max(d['dims'])/256))),('uSteps',d['steps']),('uOpacity',1),('logDepthBufFC',2/math.log2(31))]:scalar(p,k,v)
            gl('Uniform2f',None,I,F,F)(uni(p,'uPixels'),*d['dims']);gl('Uniform1i',None,I,I)(uni(p,'uPhoto'),0);gl('Uniform1i',None,I,I)(uni(p,'uBroad'),1)
            gl('Enable',None,U)(0x0be2)
            if mesh:
                gl('Enable',None,U)(0x0b44);gl('CullFace',None,U)(0x0404);gl('BlendFuncSeparate',None,U,U,U,U)(0x0302,0x0303,1,0x0303)
                buf=[attr(p,'position',3,d['tri'])]
            else:
                gl('Disable',None,U)(0x0b44);gl('BlendFuncSeparate',None,U,U,U,U)(1,1,0,1)
                buf=[attr(p,k,c,stars[k]) for k,c in [('position',3),('starColor',3),('diameter',1)]]
            gl('DrawArrays',None,U,I,I)(4 if mesh else 0,0,n)
            for loc,b in buf:gl('DisableVertexAttribArray',None,U)(loc);gl('DeleteBuffers',None,I,P)(1,C.byref(b))
        raw=(C.c_ubyte*(4*side*side))();gl('ReadPixels',None,I,I,I,I,U,U,P)(0,0,side,side,0x1908,0x1401,raw)
        assert gl('GetError',U)()==0
        return Image.frombytes('RGBA',(side,side),bytes(raw)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')
    # 生产 JS 计算背景修补坐标、PSF、星点、盒几何、矩阵和相机 uniform；仅 Canvas 栅格化使用 Pillow 代替。
    rows=[]
    for id in ['blue','remnant','pillar','galaxy','rose']:
        img=Image.open(here.parent/'public/data/jpg-depth'/f'{id}.jpg').convert('RGB');W,H=img.size;s=min(1,960/max(W,H));w,h=max(1,int(W*s+.5)),max(1,int(H*s+.5))
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'detection.rgba';path.write_bytes(img.resize((w,h),Image.Resampling.BILINEAR).convert('RGBA').tobytes())
            d=json.loads(subprocess.check_output(['node',str(here/'test-reference-deep-volume.mjs'),'--fixture',id,str(path),str(W),str(H),str(side)]))
        for x,y,r0,r1,r,gc,b in d['patches']:
            x0=max(0,math.floor((x-r1)*W/w));x1=min(W,math.ceil((x+r1)*W/w));y0=max(0,math.floor((y-r1)*H/h));y1=min(H,math.ceil((y+r1)*H/h))
            mask=bytes(round(255*max(0,min(1,(r1-math.hypot((i+.5)*w/W-x,(j+.5)*h/H-y))/(r1-r0)))) for j in range(y0,y1) for i in range(x0,x1))
            img.paste((r,gc,b),(x0,y0,x1,y1),Image.frombytes('L',(x1-x0,y1-y0),mask))
        tex=[texture(0,img),texture(1,img.resize(d['broad'],Image.Resampling.BILINEAR))]
        frames=[draw_frame(id,d,cam) for cam in d['mats']];means=[ImageStat.Stat(im.convert('L')).mean[0] for im in frames]
        delta=ImageStat.Stat(ImageChops.difference(frames[0],frames[1]).convert('L')).mean[0]
        assert min(means)>1 and delta>.75,(id,means,delta)
        print(id,'stars',len(d['patches']),'mean',','.join('%.1f'%v for v in means),'orbit delta','%.2f'%delta)
        for t in tex:gl('DeleteTextures',None,I,P)(1,C.byref(t))
        if id in ['blue','remnant']: rows.append((id,W,H,frames))
    width=side*3+48;height=92+len(rows)*(side+57)+20
    board=Image.new('RGB',(width,height),'#101720');pen=ImageDraw.Draw(board)
    fontpath=Path(os.environ['WINDIR'])/'Fonts/msyh.ttc';font=lambda n:ImageFont.truetype(str(fontpath),n)
    pen.text((14,8),'单张观测图的体积重建  /  GPU 多视角对照',font=font(27),fill='#e8f0f7')
    pen.text((16,53),'固定 33° 视场，零背景；移动同一台透视相机重新积分。纵深为形态推断，非观测距离。',font=font(17),fill='#a9bdca')
    for r,(id,W,H,frames) in enumerate(rows):
        y=92+r*(side+57);name={'blue':'蓝云','remnant':'遗迹'}[id];pen.text((16,y),f'{name}   {id}.jpg   {W} × {H}',font=font(17),fill='#8fdacf')
        for i,frame in enumerate(frames):
            x=12+i*(side+12);board.paste(frame,(x,y+27));pen.text((x,y+side+29),(['正视 0°  /  距中心 5.29 R','斜视 42°  /  距中心 5.29 R'] if id=='blue' else ['正视 0°  /  距中心 3.48 R','斜视 42°  /  距中心 3.48 R'])[i] if i<2 else '靠近 22°  /  距中心 1.39 R',font=font(15),fill='#cfdae1')
    out=here.parent/'docs/jpg-depth-check.png';board.save(out);print('PNG:',out)
    for p in linked.values(): gl('DeleteProgram',None,U)(p)
