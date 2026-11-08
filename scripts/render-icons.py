"""Regenerate cloud icon assets: pip install cairosvg pillow."""
from pathlib import Path
import shutil
import cairosvg
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'design/icon-cloud/nohop-cloud.svg'
for size, target in [(1024, 'resources/appicon.png'), (256, 'resources/appicon-256.png')]:
    cairosvg.svg2png(url=str(source), write_to=str(root / target), output_width=size, output_height=size)
shutil.copyfile(root / 'resources/appicon-256.png', root / 'src/renderer/public/appicon.png')
Image.open(root / 'resources/appicon.png').save(root / 'build/windows/icon.ico', sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
