export interface Player {
  last_name: string;
  first_name: string;
  full_name: string;
  player_id?: number | null;
  fangraphs_id?: string | null;
  team: string | null;
  college?: string | null;
  position?: string | null;
  levels?: string;
  year?: number;
  age?: number;
  // Swing mechanics (MLB only)
  bat_speed?: number;
  'fast_swing_%'?: number;
  swing_length?: number;
  attack_angle?: number;
  attack_direction?: number;
  'ideal_angle_%'?: number;
  swing_tilt?: number;
  // Contact quality
  avg_ev?: number;
  avg_la?: number;
  'barrel_%'?: number;
  'hard_hit%'?: number;
  ev90?: number;
  max_ev?: number;
  // Plate discipline
  'bb%'?: number;
  'k%'?: number;
  'z-swing%'?: number;
  'z-whiff%'?: number;
  'chase%'?: number;
  'o-whiff%'?: number;
  'pull_air%'?: number;
  espn_image?: string;
  // MLB batting stats (optional)
  hr?: number;
  // Minor league stats (optional)
  ab?: number;
  pa?: number;
  ba?: string | number;
  obp?: string | number;
  slg?: string | number;
  avg?: number;
  'wrc+'?: number;
  // Minor league alternate names
  k_percent?: number;
  bb_percent?: number;
  zone_swing_percent?: number;
  zone_contact_percent?: number;
  chase_percent?: number;
  xwoba_percent?: number;
  woba_percent?: number;
  ground_ball_percent?: number;
  fly_ball_percent?: number;
  line_drive_percent?: number;
  pop_up_percent?: number;
  launch_speed_90?: number;
  launch_speed?: number;
  max_launch_speed?: number;
  barrel_percent?: number;
}
