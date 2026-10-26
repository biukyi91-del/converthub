#!/usr/bin/env bash
# ConvertHub end-to-end test (spec §10)
# Exercises the real API: batch submit -> poll -> download -> magic bytes -> error case.
# Usage: bash scripts/e2e-test.sh   (dev server must be running on :3000)

set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
FX=/tmp/fx
PROJECT=/home/z/my-project
PASS=0
FAIL=0

ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }

section() { echo; echo "== $1 =="; }

# ---------------------------------------------------------------- fixtures
section "fixtures (generated with sharp + ffmpeg)"
rm -rf "$FX" && mkdir -p "$FX"

printf 'Hello ConvertHub\nThis is a plain text fixture for PDF rendering.\n' > "$FX/text.txt"

cat > "$FX/sample.md" <<'EOF'
# Sample Document

Some **bold** text and a [link](https://example.com).

- first item
- second item
EOF

cat > "$FX/sample.csv" <<'EOF'
name,role,score
Ada,engineer,99
Linus,kernel,98
Grace,admiral,100
EOF

if (cd "$PROJECT" && node -e "
const s = require('sharp');
s({ create: { width: 320, height: 200, channels: 4, background: { r: 181, g: 56, b: 54, alpha: 1 } } })
  .png().toFile('$FX/sample.png').then(() => console.log('png ok'));
"); then ok "sample.png (sharp)"; else bad "sample.png generation"; fi

if ffmpeg -y -nostdin -loglevel error -f lavfi -i "sine=frequency=440:duration=1" -q:a 9 "$FX/sample.mp3"; then
  ok "sample.mp3 (ffmpeg sine)"
else bad "sample.mp3 generation"; fi

if ffmpeg -y -nostdin -loglevel error -f lavfi -i "testsrc=duration=2:size=320x240:rate=15" \
    -c:v libx264 -pix_fmt yuv420p "$FX/sample.mp4"; then
  ok "sample.mp4 (ffmpeg testsrc)"
else bad "sample.mp4 generation"; fi

if (cd "$FX" && zip -q -j bundle.zip text.txt sample.csv); then
  ok "bundle.zip (system zip)"
else bad "bundle.zip generation"; fi

# ---------------------------------------------------------------- batch submit
section "POST /api/jobs (11 conversions in ONE multipart request)"
# order matters: targets[] is parallel to files[]
FILES=(
  "$FX/text.txt"     # 0 txt  -> pdf   (playwright PDF)
  "$FX/sample.md"    # 1 md   -> pdf   (marked -> playwright PDF)
  "$FX/sample.csv"   # 2 csv  -> xlsx  (SheetJS)
  "$FX/sample.png"   # 3 png  -> jpg   (sharp, quality 60 + resize width 40)
  "$FX/sample.png"   # 4 png  -> webp  (sharp)
  "$FX/sample.png"   # 5 png  -> pdf   (pdf-lib embed)
  "$FX/sample.mp3"   # 6 mp3  -> ogg   (ffmpeg libvorbis)
  "$FX/sample.mp4"   # 7 mp4  -> webm  (ffmpeg vp9)
  "$FX/sample.mp4"   # 8 mp4  -> gif   (ffmpeg palettegen)
  "$FX/text.txt"     # 9 txt  -> zip   (adm-zip pack)
  "$FX/bundle.zip"   # 10 zip -> tar.gz (extract + repack)
)
TARGETS='[{"target":"pdf"},{"target":"pdf"},{"target":"xlsx"},{"target":"jpg","settings":{"quality":60,"width":40}},{"target":"webp"},{"target":"pdf"},{"target":"ogg"},{"target":"webm"},{"target":"gif"},{"target":"zip"},{"target":"tar.gz"}]'

CURL_ARGS=(-s -X POST "$BASE/api/jobs")
for f in "${FILES[@]}"; do CURL_ARGS+=(-F "files=@$f"); done
CURL_ARGS+=(-F "targets=$TARGETS")

RESP=$(curl "${CURL_ARGS[@]}")
IDS=$(echo "$RESP" | jq -r 'if .jobs then [.jobs[].id] | join(",") else "" end')
COUNT=$(echo "$IDS" | awk -F',' '{print NF}')

if [ -n "$IDS" ] && [ "$COUNT" -eq 11 ]; then
  ok "batch accepted: 11 jobs created"
else
  bad "batch submit failed: $(echo "$RESP" | head -c 400)"
  echo; echo "RESULT: $PASS passed, $FAIL failed"; exit 1
fi

# ---------------------------------------------------------------- poll
section "poll GET /api/jobs?ids=... (max 90s)"
FINAL=""
for i in $(seq 1 90); do
  STATUSES=$(curl -s "$BASE/api/jobs?ids=$IDS" | jq -r '[.jobs[].status] | join(",")')
  if ! echo "$STATUSES" | grep -qE 'queued|processing'; then
    FINAL="$STATUSES"
    echo "  all jobs settled after ~${i}s: $STATUSES"
    break
  fi
  sleep 1
done

if [ -z "$FINAL" ]; then
  FINAL=$(curl -s "$BASE/api/jobs?ids=$IDS" | jq -r '[.jobs[].status] | join(",")')
  echo "  timeout reached, last statuses: $FINAL"
fi

PAIRS=("txt->pdf" "md->pdf" "csv->xlsx" "png->jpg" "png->webp" "png->pdf" "mp3->ogg" "mp4->webm" "mp4->gif" "txt->zip" "zip->tar.gz")
JOBS_JSON=$(curl -s "$BASE/api/jobs?ids=$IDS")
declare -a JOB_IDS=()
i=0
for id in $(echo "$IDS" | tr ',' ' '); do JOB_IDS[$i]="$id"; i=$((i+1)); done

for idx in "${!PAIRS[@]}"; do
  ROW=$(echo "$JOBS_JSON" | jq -r ".jobs[$idx]")
  STATUS=$(echo "$ROW" | jq -r '.status')
  SIZE=$(echo "$ROW" | jq -r '.outputSizeBytes // 0')
  ERR=$(echo "$ROW" | jq -r '.error // ""')
  if [ "$STATUS" = "finished" ] && [ "$SIZE" -gt 0 ] 2>/dev/null; then
    ok "${PAIRS[$idx]}  finished, outputSizeBytes=$SIZE"
  else
    bad "${PAIRS[$idx]}  status=$STATUS size=$SIZE error=$ERR"
  fi
done

# ---------------------------------------------------------------- downloads + magic bytes
section "GET /api/download/:id + magic bytes"
check_magic() {
  local label="$1" id="$2" want="$3"
  local out="/tmp/fx/dl-$label"
  local code
  code=$(curl -s -o "$out" -w '%{http_code}' "$BASE/api/download/$id")
  if [ "$code" != "200" ]; then bad "$label download HTTP $code"; return; fi
  local hex
  hex=$(head -c 4 "$out" | od -An -tx1 | tr -d ' \n')
  case "$want" in
    pdf)  [[ "$hex" == 25504446* ]] && ok "$label magic bytes = %PDF" || bad "$label magic bytes = $hex (want %PDF)" ;;
    jpg)  [[ "$hex" == ffd8ff* ]]   && ok "$label magic bytes = JPEG (ffd8ff)" || bad "$label magic bytes = $hex (want ffd8ff)" ;;
    zip)  [[ "$hex" == 504b* ]]     && ok "$label magic bytes = PK (zip/xlsx)" || bad "$label magic bytes = $hex (want PK)" ;;
    ogg)  [[ "$hex" == 4f676753* ]] && ok "$label magic bytes = OggS" || bad "$label magic bytes = $hex (want OggS)" ;;
    webm) [[ "$hex" == 1a45dfa3* ]] && ok "$label magic bytes = EBML (webm)" || bad "$label magic bytes = $hex (want 1a45dfa3)" ;;
    gif)  [[ "$hex" == 47494638* ]] && ok "$label magic bytes = GIF8" || bad "$label magic bytes = $hex (want GIF8)" ;;
    targz)[[ "$hex" == 1f8b* ]]     && ok "$label magic bytes = gzip (tar.gz)" || bad "$label magic bytes = $hex (want 1f8b)" ;;
  esac
}

check_magic "txt-pdf"   "${JOB_IDS[0]}" pdf
check_magic "png-jpg"   "${JOB_IDS[3]}" jpg
check_magic "csv-xlsx"  "${JOB_IDS[2]}" zip
check_magic "mp3-ogg"   "${JOB_IDS[6]}" ogg
check_magic "mp4-webm"  "${JOB_IDS[7]}" webm
check_magic "mp4-gif"   "${JOB_IDS[8]}" gif
check_magic "zip-targz" "${JOB_IDS[10]}" targz

# resized png->jpg must be 40px wide (settings pipeline proof)
WIDTH=$(cd "$PROJECT" && node -e "require('sharp')('/tmp/fx/dl-png-jpg').metadata().then(m => console.log(m.width))")
if [ "$WIDTH" = "40" ]; then ok "png->jpg resize honored (width=40px)"; else bad "png->jpg width=$WIDTH (want 40)"; fi

# ---------------------------------------------------------------- download-all
section "GET /api/download-all (zip on the fly)"
ALLZIP=/tmp/fx/download-all.zip
CODE=$(curl -s -o "$ALLZIP" -w '%{http_code}' "$BASE/api/download-all?ids=$IDS")
if [ "$CODE" = "200" ] && head -c 2 "$ALLZIP" | od -An -c | grep -q 'P   K'; then
  N=$(unzip -l "$ALLZIP" | grep -cE '^\s+[0-9]+\s+[0-9-]+ [0-9:]+\s+\S')
  ok "download-all zip ok, contains $N files"
else
  bad "download-all failed (HTTP $CODE)"
fi

# ---------------------------------------------------------------- history
section "GET /api/jobs?history=1"
HN=$(curl -s "$BASE/api/jobs?history=1&limit=30" | jq '.jobs | length')
if [ "$HN" -ge 11 ]; then ok "history returns $HN jobs"; else bad "history returns $HN jobs (want >= 11)"; fi

# ---------------------------------------------------------------- error case
section "error case: unsupported .xyz upload -> 4xx friendly JSON"
printf 'this is not a real file format\n' > "$FX/bad.xyz"
ERR_CODE=$(curl -s -o /tmp/fx/err.json -w '%{http_code}' -X POST "$BASE/api/jobs" \
  -F "files=@$FX/bad.xyz" -F 'targets=[{"target":"pdf"}]')
ERR_MSG=$(jq -r '.error.message // ""' /tmp/fx/err.json)
if [[ "$ERR_CODE" == 4* ]] && [ -n "$ERR_MSG" ]; then
  ok "XYZ rejected with HTTP $ERR_CODE: \"$ERR_MSG\""
else
  bad "expected 4xx + friendly message, got HTTP $ERR_CODE body: $(head -c 200 /tmp/fx/err.json)"
fi

# ---------------------------------------------------------------- delete
section "DELETE /api/jobs/:id"
DEL_ID="${JOB_IDS[9]}"
DCODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/jobs/$DEL_ID")
GONE=$(curl -s "$BASE/api/jobs?ids=$DEL_ID" | jq '.jobs | length')
if [ "$DCODE" = "200" ] && [ "$GONE" = "0" ]; then
  ok "job deleted, files purged"
else
  bad "delete failed (HTTP $DCODE, remaining=$GONE)"
fi

# ---------------------------------------------------------------- summary
echo
echo "======================================"
echo "RESULT: $PASS passed, $FAIL failed"
echo "======================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
