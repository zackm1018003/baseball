#!/bin/bash
# Calculate VAA per pitch type per pitcher from Statcast CSV data
# Pre-processes CSV to handle quoted commas properly

STATCAST_DIR="C:/Users/Zack/baseball/scripts/statcast"
OUTPUT_FILE="C:/Users/Zack/baseball/scripts/vaa_results.json"

echo "[" > "$OUTPUT_FILE"
FIRST_PLAYER=1

for CSV in "$STATCAST_DIR"/*.csv; do
  PID=$(basename "$CSV" .csv)
  LINES=$(wc -l < "$CSV")
  if [ "$LINES" -lt 3 ]; then
    echo "Skipping $PID (no data)"
    continue
  fi

  if [ $FIRST_PLAYER -eq 0 ]; then
    echo "," >> "$OUTPUT_FILE"
  fi
  FIRST_PLAYER=0

  echo "Processing player $PID ($LINES pitches)..."

  # Step 1: Replace commas inside quoted strings with semicolons, then strip quotes
  # This handles the "des" field that contains commas
  sed 's/\r//g' "$CSV" | \
  awk '
  BEGIN { RS="\n" }
  {
    in_quote = 0
    result = ""
    for (i = 1; i <= length($0); i++) {
      c = substr($0, i, 1)
      if (c == "\"") {
        in_quote = !in_quote
      } else if (c == "," && in_quote) {
        result = result ";"
      } else {
        result = result c
      }
    }
    print result
  }' | \
  awk -F',' '
  NR == 1 {
    gsub(/\xEF\xBB\xBF/, "", $1)
    for (i = 1; i <= NF; i++) {
      col[$i] = i
    }
    pn = col["pitch_name"]
    pt = col["pitch_type"]
    v_vy0 = col["vy0"]
    v_vz0 = col["vz0"]
    v_ay = col["ay"]
    v_az = col["az"]
    v_rpz = col["release_pos_z"]
    v_ext = col["release_extension"]
    next
  }

  NR > 1 {
    pname = $pn
    if (pname == "" || pname == "null" || pname == "Intentional Ball" || pname == "Pitch Out" || pname == "Other") next

    vy0 = $v_vy0 + 0
    vz0 = $v_vz0 + 0
    ay_val = $v_ay + 0
    az_val = $v_az + 0
    rpz = $v_rpz + 0
    ext = $v_ext + 0

    if (vy0 == 0 || ay_val == 0) next

    y0 = 50.0
    yf = 17.0 / 12.0

    disc = vy0*vy0 - 2*ay_val*(y0 - yf)
    if (disc < 0) next
    vy_f = -sqrt(disc)

    if (ay_val == 0) next
    t = (vy_f - vy0) / ay_val

    vz_f = vz0 + az_val * t

    if (vy_f == 0) next
    # VAA = descent angle below horizontal = atan(vz_f / |vy_f|) in degrees
    # vz_f is negative (ball dropping), vy_f is negative (toward plate)
    # Result should be negative (e.g. -5.3 degrees)
    vaa = atan2(vz_f, -vy_f) * 180 / 3.14159265358979

    count[pname]++
    sum_vaa[pname] += vaa
    sum_rpz[pname] += rpz
    sum_ext[pname] += ext
  }

  END {
    printf "  {\"player_id\": %s, \"pitches\": {", pid
    first = 1
    for (pname in count) {
      if (count[pname] < 10) continue
      avg_vaa = sum_vaa[pname] / count[pname]
      avg_rpz = sum_rpz[pname] / count[pname]
      avg_ext = sum_ext[pname] / count[pname]

      if (!first) printf ", "
      first = 0
      printf "\"%s\": {\"vaa\": %.2f, \"release_height\": %.2f, \"extension\": %.2f, \"count\": %d}", pname, avg_vaa, avg_rpz, avg_ext, count[pname]
    }
    printf "}}"
  }
  ' pid="$PID" >> "$OUTPUT_FILE"

done

echo "" >> "$OUTPUT_FILE"
echo "]" >> "$OUTPUT_FILE"

echo ""
echo "Results written to $OUTPUT_FILE"
