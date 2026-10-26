#!/bin/bash
# E2E test: unlimited batch + live preview endpoints
set -e
cd /home/z/my-project
BASE=http://127.0.0.1:3000
FX=/tmp/fx-preview-test
rm -rf $FX && mkdir -p $FX

# --- fixtures: 12 varied files (proves >10 file batch works) ---
cd $FX
echo "Hello ConvertHub preview" > t1.txt; cp t1.txt t2.txt; cp t1.txt t3.txt; cp t1.txt t4.txt; cp t1.txt t5.txt
cp t1.txt t6.txt; cp t1.txt t7.txt; cp t1.txt t8.txt; cp t1.txt t9.txt; cp t1.txt t10.txt; cp t1.txt t11.txt; cp t1.txt t12.txt
# a png + mp3 for preview mime checks
node -e "const s=require('/home/z/my-project/node_modules/sharp');s({create:{width:80,height:60,channels:3,background:{r:180,g:56,b:54}}}).png().toFile('$FX/img.png').then(()=>console.log('png ok'))"
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=1" -c:a libmp3lame "$FX/audio.mp3"

cd $FX
# --- build multipart: 14 files (12 txt->pdf? txt->pdf is heavy; use txt->zip mix) ---
# 12 txt -> pdf via soffice is slow; use txt -> zip for 10 of them + png->jpg + mp3->ogg
TARGETS='['
for i in $(seq 1 12); do TARGETS+='{"target":"zip","settings":{}},'; done
TARGETS+='{"target":"jpg","settings":{"quality":90}},{"target":"ogg","settings":{"audio_bitrate":192}}]'

curl -s -X POST $BASE/api/jobs \
  -F "files=@t1.txt" -F "files=@t2.txt" -F "files=@t3.txt" -F "files=@t4.txt" \
  -F "files=@t5.txt" -F "files=@t6.txt" -F "files=@t7.txt" -F "files=@t8.txt" \
  -F "files=@t9.txt" -F "files=@t10.txt" -F "files=@t11.txt" -F "files=@t12.txt" \
  -F "files=@img.png" -F "files=@audio.mp3" \
  -F "targets=$TARGETS" -o /tmp/jobs-resp.json -w "POST /api/jobs HTTP %{http_code}\n"

python3 - <<'PY'
import json
d = json.load(open('/tmp/jobs-resp.json'))
jobs = d.get('jobs', [])
print(f"jobs created: {len(jobs)}")
assert len(jobs) == 14, "EXPECTED 14 JOBS (over the old limit of 10)!"
open('/tmp/job-ids.txt','w').write(",".join(x['id'] for x in jobs))
m = {}
for x in jobs:
    m.setdefault(x['targetFormat'], []).append(x['id'])
open('/tmp/job-ids-map.json','w').write(json.dumps(m))
PY

echo "--- polling until all finished (max 120s) ---"
for i in $(seq 1 60); do
  sleep 2
  ST=$(curl -s "$BASE/api/jobs?ids=$(cat /tmp/job-ids.txt)")
  DONE=$(echo "$ST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for j in d['jobs'] if j['status']=='finished'))")
  ERR=$(echo "$ST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for j in d['jobs'] if j['status']=='error'))")
  echo "t=$((i*2))s finished=$DONE error=$ERR / 14"
  if [ "$((DONE+ERR))" -ge 14 ]; then break; fi
done

echo "--- failures detail (if any) ---"
curl -s "$BASE/api/jobs?ids=$(cat /tmp/job-ids.txt)" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for j in d['jobs']:
    if j['status']=='error': print('ERR:', j['originalName'], '->', j['error'])
    if j['status']!='finished': print('NOT FINISHED:', j['originalName'], j['status'])
"

echo "--- preview checks ---"
# jpg preview: magic bytes + inline disposition
JPG_ID=$(python3 -c "import json; m=json.load(open('/tmp/job-ids-map.json')); print(m['jpg'][0])")
curl -s -D /tmp/h1.txt "$BASE/api/preview/$JPG_ID" -o /tmp/prev.jpg
grep -i "content-type" /tmp/h1.txt; grep -i "content-disposition" /tmp/h1.txt
head -c 3 /tmp/prev.jpg | xxd | head -1
file /tmp/prev.jpg

# ogg preview
OGG_ID=$(python3 -c "import json; m=json.load(open('/tmp/job-ids-map.json')); print(m['ogg'][0])")
curl -s -D /tmp/h2.txt "$BASE/api/preview/$OGG_ID" -o /tmp/prev.ogg
grep -i "content-type" /tmp/h2.txt; file /tmp/prev.ogg

# zip listing preview
ZIP_ID=$(python3 -c "import json; m=json.load(open('/tmp/job-ids-map.json')); print(m['zip'][0])")
echo "zip listing:"; curl -s "$BASE/api/preview/$ZIP_ID?list=1" | head -c 300; echo

# make one pdf for iframe preview test
echo "# T" > p.md
curl -s -X POST $BASE/api/jobs -F "files=@p.md" -F 'targets=[{"target":"pdf","settings":{}}]' -o /tmp/pdf-resp.json -w "POST md->pdf HTTP %{http_code}\n"
PDF_ID=$(python3 -c "import json; print(json.load(open('/tmp/pdf-resp.json'))['jobs'][0]['id'])")
for i in $(seq 1 30); do sleep 2; S=$(curl -s "$BASE/api/jobs?ids=$PDF_ID" | python3 -c "import json,sys; print(json.load(sys.stdin)['jobs'][0]['status'])"); [ "$S" = "finished" ] && break; [ "$S" = "error" ] && break; done
echo "md->pdf status: $S"
curl -s -D /tmp/h3.txt "$BASE/api/preview/$PDF_ID" -o /tmp/prev.pdf
grep -i "content-type" /tmp/h3.txt; head -c 5 /tmp/prev.pdf; echo; file /tmp/prev.pdf

echo "=== TEST COMPLETE ==="
