from PIL import Image, ImageOps, ImageDraw
from pathlib import Path
folder=Path('.workbuddy/main-redesign-20261119')
items=[('cinematic-sun-v202.jpg','Sun / GPU / 4096 x 2048 sphere'),('cinematic-orion-v202.jpg','Orion / GPU / 192^3 open blister'),('cinematic-pillars-final-v202.jpg','NASA/STScI Pillars / GPU / 160^3')]
canvas=Image.new('RGB',(1440,384),(7,12,19));draw=ImageDraw.Draw(canvas)
for i,(name,label) in enumerate(items):
 image=Image.open(folder/name);image=ImageOps.fit(image,(480,336));canvas.paste(image,(i*480,34));draw.text((i*480+12,10),label,fill=(210,224,234))
canvas.save(folder/'cinematic-v202-contact.jpg',quality=94)
print(folder/'cinematic-v202-contact.jpg')
