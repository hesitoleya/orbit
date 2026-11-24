from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw
p=Path('.workbuddy/v207-quality');stats={}
canvas=Image.new('RGB',(1400,1040),(5,9,15));d=ImageDraw.Draw(canvas)
for row,kind in enumerate(['orion','pillars']):
 ims=[]
 for col,mode in enumerate(['baseline','filtered']):
  im=Image.open(p/f'{kind}-{mode}-gpu.jpg').convert('RGB');ims.append(np.asarray(im,dtype=float));canvas.paste(im.resize((700,490)),(col*700,row*520+30));d.text((col*700+10,row*520+10),f'{kind} / '+('v206 nearest oct cache' if col==0 else 'v207 filtered incoming + dust response'),fill=(225,235,240))
 diff=np.abs(ims[1]-ims[0]);stats[kind]={'wholeFrameMeanAbsoluteRGBDelta':float(diff.mean()),'wholeFrameMaxRGBDelta':float(diff.max()),'pixelsMaxChannelDeltaOver4':int((diff.max(2)>4).sum()),'note':'JPEG same preset angle and grade; includes tiny star jitter differences. Not a filament resolution or cinematic acceptance metric.'}
canvas.save(p/'v206-v207-light-gpu.jpg',quality=94)
(p/'comparison-metrics.json').write_text(json.dumps(stats,indent=2)+'\n');print(json.dumps(stats,indent=2))
