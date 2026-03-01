#!/bin/bash
# Fetch Statcast data from Baseball Savant per pitcher and calculate VAA

PLAYER_IDS="594798 543037 645261 669203 661403 675911 605483 660271 657277 592332"
OUTPUT_DIR="C:/Users/Zack/baseball/scripts/statcast"
mkdir -p "$OUTPUT_DIR"

for PID in $PLAYER_IDS; do
  echo "Fetching Statcast data for player $PID..."

  # Try 2025 first
  curl -sL -o "$OUTPUT_DIR/${PID}.csv" \
    "https://baseballsavant.mlb.com/statcast_search/csv?all=true&player_type=pitcher&pitchers_lookup%5B%5D=${PID}&hfSea=2025%7C&type=details"

  LINES=$(wc -l < "$OUTPUT_DIR/${PID}.csv" 2>/dev/null)
  if [ "$LINES" -lt 5 ]; then
    echo "  No 2025 data ($LINES lines), trying 2024..."
    curl -sL -o "$OUTPUT_DIR/${PID}.csv" \
      "https://baseballsavant.mlb.com/statcast_search/csv?all=true&player_type=pitcher&pitchers_lookup%5B%5D=${PID}&hfSea=2024%7C&type=details"
    LINES=$(wc -l < "$OUTPUT_DIR/${PID}.csv" 2>/dev/null)
  fi

  # Verify it's the right pitcher
  PNAME=$(awk -F',' 'NR==2{gsub(/"/, "", $6); print $6}' "$OUTPUT_DIR/${PID}.csv")
  echo "  Got $LINES pitches for $PNAME"
  sleep 2
done

echo "Done fetching."
