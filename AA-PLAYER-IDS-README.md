# AA Player ID Lookup - Instructions

## Problem

The AA dataset in `henry-3` has 545 players but is missing player IDs. These IDs are essential for:
- Displaying player images
- Fetching MLB API data
- Proper player page navigation

## Why Automatic Lookup Failed

The MLB Stats API doesn't have most AA-level players in its database. Out of 545 players, only a handful are found via the API because:
- Many haven't made it to MLB yet
- Some are recent draft picks
- Minor league rosters aren't fully in the MLB Stats API

## Solutions Available

### Option 1: Manual Entry Tool (Recommended for small batches)

Use the interactive helper to add IDs as you find them:

```bash
node scripts/manual-id-helper.js
```

Features:
- Lists players without IDs
- Accepts IDs in format: `Tommy White=695720`
- Auto-saves progress
- Fuzzy name matching
- Can resume later

Commands:
- `list` - Show players without IDs
- `save` - Save progress
- `export` - Create final henry-3-updated file
- `quit` - Exit and save

### Option 2: Bulk Import (Recommended if you have a list)

If you can get a CSV/TSV file with player names and IDs from razzball.com or elsewhere:

```bash
node scripts/bulk-import-ids.js player-mappings.txt
```

Accepted formats:
```
Tommy White    695720
695720    Tommy White
Tommy White,695720
695720,Tommy White
```

### Option 3: Websites for Finding IDs

1. **Razzball** (easiest): https://razzball.com/mlbamids/
   - Search by name
   - Get MLBAM ID (player_id)

2. **Baseball Reference**: https://www.baseball-reference.com/
   - Search player name
   - Look in URL for player ID
   - More comprehensive for minor leaguers

3. **FanGraphs**: https://www.fangraphs.com/
   - Search player
   - Has prospects database

## Current Status

Files created:
- `henry-3` - Original AA data (545 players, no IDs)
- `henry-3-with-ids` - Attempted automatic lookup (0 IDs found)
- `henry-3-not-found.txt` - List of 544 players not found in MLB API
- `scripts/manual-id-helper.js` - Interactive ID entry tool
- `scripts/bulk-import-ids.js` - Bulk import from file
- `scripts/add-player-ids-v2.js` - Automatic lookup (can retry later)

## Recommended Workflow

1. **Start with top prospects** - These are more likely to have IDs:
   - Tommy White (ID: 695720) ✓
   - Termarr Johnson (ID: 702261) ✓
   - Travis Bazzana (ID: 683953) ✓
   - Charlie Condon, Walker Jenkins, etc.

2. **Use razzball** for quick lookups:
   - Go to https://razzball.com/mlbamids/
   - Search each player
   - Copy the MLBAM ID

3. **Enter IDs** using manual helper:
   ```bash
   node scripts/manual-id-helper.js
   ```

4. **Export when done**:
   - Type `export` in the tool
   - This creates `henry-3-updated` with IDs

5. **Replace henry-3** with the updated version:
   ```bash
   cp henry-3-updated henry-3
   ```

6. **Regenerate players3.json**:
   ```bash
   node scripts/parseData.js 3
   ```

## Alternative: Work Without Full IDs

If getting all 545 IDs is too time-consuming, you could:
- Add IDs for just the top 50-100 prospects
- Let the app gracefully handle missing IDs
- Update the similarity tool to work without player_id requirement

## Questions?

The main challenge is that AA players simply aren't all in public databases yet. You may not be able to find IDs for all players, especially:
- Recent draft picks
- International signees
- Lower-level prospects

This is normal and expected for AA-level data.
