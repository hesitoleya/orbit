from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw
p=Path('.workbuddy/v206-quality')
names=['m51-baseline-gpu.jpg','m51-final-high-gpu.jpg']
arrays=[np.asarray(Image.open(p/n).convert('RGB')) for n in names]
mask=np.ones(arrays[0].shape[:2],bool);mask[100:700,200:720]=False
stats={}
for name,im in zip(names,arrays):
 rgb=im.astype(float);lum=rgb@np.array([.2126,.7152,.0722]);neutral=(rgb.max(2)-rgb.min(2))<35
 stats[name]={'backgroundMaskPixels':int(mask.sum()),'backgroundMeanLuma':float(lum[mask].mean()),'backgroundNeutralPixelsOver80':int((mask&neutral&(lum>80)).sum()),'backgroundNeutralPixelsOver160':int((mask&neutral&(lum>160)).sum())}
base=stats[names[0]];final=stats[names[1]]
assert final['backgroundNeutralPixelsOver80']<base['backgroundNeutralPixelsOver80']*.1
stats['interpretation']='Same camera and gradePhase0 GPU JPEGs. Fixed background mask excludes x200:720 y100:700 (both galaxies), thresholds only describe this frame, not physical fidelity or general performance. Statistical overlay removed; no whole-scene exposure change. Sun locator distance-gated.'
(p/'comparison-metrics.json').write_text(json.dumps(stats,indent=2)+'\n')
canvas=Image.new('RGB',(1400,520),(5,9,15));draw=ImageDraw.Draw(canvas)
for i,(a,title) in enumerate(zip(arrays,['v205 / statistical members in beauty mode','v206 / default beauty, no invented member stars'])):
 canvas.paste(Image.fromarray(a).resize((700,490)),(i*700,30));draw.text((i*700+10,10),title,fill=(225,235,240))
canvas.save(p/'v205-v206-m51-gpu.jpg',quality=94)
print(json.dumps(stats,indent=2))
