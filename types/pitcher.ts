export interface PitchTypeData {
  velo?: number;        // mph
  spin?: number;        // rpm (spin rate)
  spin_pct?: number;    // spin efficiency %
  movement_h?: number;  // horizontal break (inches)
  movement_v?: number;  // induced vertical break (inches)
  usage?: number;       // pitch usage %
  vaa?: number;         // vertical approach angle (degrees)
  vrel?: number;        // vertical release point (feet)
  hrel?: number;        // horizontal release point (feet)
  ext?: number;         // extension (feet)
  whiff?: number;       // whiff %
  zone_pct?: number;    // zone %
  xwoba?: number;       // expected wOBA on contact
  barrel_pct?: number;  // barrel % on batted balls
  location_grid?: number[][];  // 25x20 density grid for heatmap (normalized 0-1)
  location_count?: number;     // number of pitches used to compute grid
}

export interface Pitcher {
  // Identity
  full_name: string;
  player_id?: number;
  fangraphs_id?: string;

  // Team/College
  team: string | null;
  college?: string;

  // Basic Info
  age?: number;
  throws?: 'R' | 'L';
  arm_angle?: number;    // degrees
  strike_pct?: number;   // strike %

  // Per-pitch-type data (new structured format)
  ff?: PitchTypeData;   // 4-Seam Fastball
  si?: PitchTypeData;   // Sinker
  fc?: PitchTypeData;   // Cutter
  ch?: PitchTypeData;   // Changeup
  fs?: PitchTypeData;   // Splitter
  fo?: PitchTypeData;   // Forkball
  cu?: PitchTypeData;   // Curveball
  kc?: PitchTypeData;   // Knuckle Curve
  sl?: PitchTypeData;   // Slider
  st?: PitchTypeData;   // Sweeper
  sv?: PitchTypeData;   // Slurve

  // === Legacy flat fields (kept for backward compat) ===

  // Pitch Velocity (mph)
  fastball_velo?: number;
  slider_velo?: number;
  changeup_velo?: number;
  curveball_velo?: number;
  cutter_velo?: number;

  // Spin Rate (rpm)
  fastball_spin?: number;
  slider_spin?: number;
  changeup_spin?: number;
  curveball_spin?: number;
  cutter_spin?: number;

  // Pitch Movement (inches)
  fastball_movement_h?: number;  // horizontal
  fastball_movement_v?: number;  // vertical
  slider_movement_h?: number;
  slider_movement_v?: number;
  changeup_movement_h?: number;
  changeup_movement_v?: number;
  curveball_movement_h?: number;
  curveball_movement_v?: number;

  // Pitch Usage
  fastball_usage?: number;  // percentage
  slider_usage?: number;
  changeup_usage?: number;
  curveball_usage?: number;
  cutter_usage?: number;

  // Vertical Approach Angle (degrees, negative = descending)
  fastball_vaa?: number;
  slider_vaa?: number;
  changeup_vaa?: number;
  curveball_vaa?: number;
  cutter_vaa?: number;

  // Release Info
  release_height?: number;  // feet
  extension?: number;       // feet

  // Traditional Stats
  era?: number;
  whip?: number;
  k_per_9?: number;
  bb_per_9?: number;
  ip?: number;
  wins?: number;
  losses?: number;
  saves?: number;
}
