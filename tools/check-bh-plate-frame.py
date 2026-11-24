"""Render the shipped fragment shader against a decoded frame; no web server needed."""
import re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'tools/.reference-python'))
import moderngl as gl
from PIL import Image
src=(root/'public/js/blackhole-reference.js').read_text(encoding='utf8')
shader=re.search(r'const fragment = `([\s\S]*?)`;',src)[1].replace('precision highp float;', '#version 330\nout vec4 result;').replace('varying vec2','in vec2').replace('texture2D(', 'texture(').replace('gl_FragColor','result').strip()
ctx=gl.create_standalone_context(require=330)
prog=ctx.program(vertex_shader='#version 330\nout vec2 vPlateUv;void main(){vec2 q=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vPlateUv=q;gl_Position=vec4(q*2.-1.,0.,1.);}',fragment_shader=shader)
im=Image.open(root/'docs/bh-reference-t7.png').convert('RGB');tex=ctx.texture(im.size,3,im.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes());tex.filter=(gl.LINEAR,gl.LINEAR);tex.repeat_x=tex.repeat_y=False;tex.use(0)
w,h=1280,720
fb=ctx.simple_framebuffer((w,h));fb.use(); vao=ctx.vertex_array(prog,[])
for name,v in dict(ready=1.,aspect=w/h,az=0.,tilt=.205,zoom=1.,plate=0).items():prog[name].value=v
vao.render(vertices=3)
out=Image.frombytes('RGB',(w,h),fb.read(components=3)).transpose(Image.Transpose.FLIP_TOP_BOTTOM);out.save(root/'docs/bh-panorama-t7.png'); print(ctx.info['GL_RENDERER'], out.getextrema())
