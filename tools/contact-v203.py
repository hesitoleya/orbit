from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
folder=Path('.workbuddy/v203-quality')
items=[('ring-gpu.jpg','Ring / GPU'),('remnant-gpu.jpg','Remnant / GPU'),('bipolar-gpu.jpg','Bipolar / GPU'),('helix-gpu.jpg','Helix / GPU')]
im=Image.new('RGB',(1000,760),(6,10,17));d=ImageDraw.Draw(im)
for i,(f,label) in enumerate(items):
 x=(i%2)*500;y=(i//2)*380;d.text((x+8,y+8),label,fill=(230,230,240));im.paste(ImageOps.fit(Image.open(folder/f),(500,350)),(x,y+30))
im.save(folder/'four-families-gpu.jpg',quality=94)
# Matched GPU framing from the v202 and final v203 presets; no color enhancement.
comparison=Image.new('RGB',(1400,1040),(6,10,17));draw=ImageDraw.Draw(comparison)
old=Path('.workbuddy/main-redesign-20261119')
for row,(left,right,label) in enumerate([(old/'cinematic-orion-v202.jpg',folder/'orion-final-sqrt-gpu.jpg','Orion'),(old/'cinematic-pillars-final-v202.jpg',folder/'pillars-final-sqrt-gpu.jpg','Pillars')]):
 for col,(path,version) in enumerate([(left,'v202'),(right,'v203')]):
  x=col*700;y=row*520;draw.text((x+12,y+10),f'{label} / {version} / actual GPU',fill=(225,235,240));comparison.paste(ImageOps.fit(Image.open(path),(700,490)),(x,y+30))
comparison.save(folder/'v202-v203-gpu-comparison.jpg',quality=94)
