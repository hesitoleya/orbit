from PIL import Image,ImageDraw
from pathlib import Path
p=Path('.workbuddy/v205-quality')
canvas=Image.new('RGB',(1400,520),(5,9,15));d=ImageDraw.Draw(canvas)
for i,(path,title) in enumerate([('.workbuddy/v204-quality/m51-final-bloomoff-gpu.jpg','v204 / analytic spiral'),(str(p/'m51-final-high-gpu.jpg'),'v205 / Hubble-guided artificial-depth volume')]):
 im=Image.open(path).convert('RGB').resize((700,490));canvas.paste(im,(i*700,30));d.text((i*700+10,10),title,fill=(225,235,240))
canvas.save(p/'v204-v205-m51-gpu.jpg',quality=94)
