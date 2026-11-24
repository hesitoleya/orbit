from PIL import Image,ImageChops,ImageStat,ImageDraw
from pathlib import Path
import numpy as np
p=Path('.workbuddy/v204-quality')
a=Image.open(p/'m51-sources-off-gpu.jpg').convert('RGB');b=Image.open(p/'m51-sources-high-gpu.jpg').convert('RGB')
d=np.array(b,dtype=np.int16)-np.array(a,dtype=np.int16)
print('Matched JPEG visual delta (lossy evidence, not radiometric benchmark):',{'mean_absolute':float(np.abs(d).mean()),'pixels_max_delta_gt3':int((np.abs(d).max(2)>3).sum()),'mean_signed':float(d.mean())})
c=Image.new('RGB',(1400,520),(5,9,15));draw=ImageDraw.Draw(c)
for i,(im,label) in enumerate([(a,'M51 volume / sources off'),(b,'M51 volume / embedded 3D sources high')]):
 c.paste(im.resize((700,490)),(i*700,30));draw.text((i*700+10,10),label,fill=(230,235,240))
c.save(p/'m51-source-contribution.jpg',quality=94)
