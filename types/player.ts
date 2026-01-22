export interface Player {
  last_name: string;
  first_name: string;
  full_name: string;
  player_id: number;
  team: string | null;
  year: number;
  age: number;
  bat_speed: number;
  'fast_swing_%': number;
  swing_length: number;
  attack_angle: number;
  attack_direction: number;
  'ideal_angle_%': number;
  swing_tilt: number;
  avg_ev: number;
  avg_la: number;
  'barrel_%': number;
  'hard_hit%': number;
  ev50: number;
  max_ev: number;
  'z-swing%': number;
  'z-whiff%': number;
  'chase%': number;
  'o-whiff%': number;
  'pull_air%': number;
  espn_image?: string;
}
