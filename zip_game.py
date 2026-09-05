import zipfile, os

ROOT = 'public'
OUT = '邪刻-网页版.zip'

if os.path.exists(OUT):
    os.remove(OUT)

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirs, files in os.walk(ROOT):
        for f in sorted(files):
            full = os.path.join(dirpath, f)
            arcname = os.path.relpath(full, ROOT).replace(os.sep, '/')
            z.write(full, arcname)

with zipfile.ZipFile(OUT, 'r') as z:
    names = z.namelist()

print('zip bytes:', os.path.getsize(OUT))
print('file count:', len(names))
for n in sorted(names):
    print(' ', n)
