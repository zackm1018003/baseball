# Percentile Rankings Feature

## Overview

I've added percentile rankings to every stat on the player detail pages. This shows how each player compares to all 632 players in your dataset.

## How It Works

### Percentile Calculation
- **0th percentile** = Worst in the dataset
- **50th percentile** = Median (average)
- **100th percentile** = Best in the dataset

For example:
- A player with 90th percentile bat speed is faster than 90% of all players
- A player with 25th percentile chase% is better than 75% (lower chase is better)

### Smart Direction Handling

The system automatically knows which stats are "lower is better":
- **Whiff rates** (z-whiff%, o-whiff%)
- **Chase%**
- Other negative indicators

For these stats, the percentile is inverted so higher percentile = better performance.

## Visual Display

Each stat now shows:
1. **Raw value** (the actual number)
2. **Percentile badge** with color coding and label

### Color Coding

- 🟢 **Elite (90-100th)** - Green background, bold
  - Player is in top 10%

- 🟢 **Great (75-89th)** - Light green background
  - Player is in top 25%

- 🔵 **Above Average (50-74th)** - Blue background
  - Player is above median

- 🟠 **Below Average (25-49th)** - Orange background
  - Player is below median

- 🔴 **Poor (0-24th)** - Red background
  - Player is in bottom 25%

## Example Display

```
Bat Speed    72    [92nd • Elite]
AVG EV       89.3  [67th • Above Avg]
Chase %      24.5  [41st • Below Avg]
```

## Stats with Percentiles

### Swing Mechanics
- Bat Speed
- Fast Swing %
- Swing Length
- Attack Angle
- Attack Direction
- Swing Tilt

### Contact Quality
- Average Exit Velocity
- Average Launch Angle
- Barrel %
- Hard Hit %
- EV50
- Ideal Angle %

### Plate Discipline
- Z-Swing %
- Z-Whiff % (inverted - lower is better)
- Chase % (inverted - lower is better)
- O-Whiff % (inverted - lower is better)

### Batted Ball Profile
- Pull Air %

## Technical Details

### Files Created
- **`lib/percentiles.ts`** - All percentile calculation logic
  - `calculatePlayerPercentiles()` - Main calculation function
  - `getPercentileColor()` - Returns appropriate color class
  - `getPercentileBgColor()` - Returns background color class
  - `getPercentileLabel()` - Returns text label (Elite, Great, etc.)
  - `formatPercentile()` - Formats as "92nd", "67th", etc.

### Files Modified
- **`app/player/[id]/page.tsx`** - Updated to display percentiles
  - Calculates percentiles on page load
  - Shows percentile badges next to each stat
  - Includes percentile guide legend

## Performance

Percentile calculation is fast:
- Done client-side on player detail page
- Processes all 632 players instantly
- No API calls required
- Updates immediately when viewing different players

## Future Enhancements

Potential additions:
- Add percentiles to player cards on home page
- Filter players by percentile ranges (show all elite bat speed players)
- Percentile charts/visualizations
- Percentile trends over time (if you add historical data)
- League/team average comparisons

## Usage

Just navigate to any player detail page:
```
/player/{player_id}
```

The percentiles will automatically display next to each stat with appropriate color coding!

## Example Players to Check

Try viewing these player IDs to see different percentile distributions:
- Player 545361 (if available) - High overall stats
- Look for players with mixed percentiles (elite in some areas, poor in others)
- Check the top/bottom of your sorted lists to see 90th+ and 10th- percentiles

The percentile system makes it immediately clear which players excel in specific areas!
