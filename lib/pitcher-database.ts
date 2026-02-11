import { Pitcher } from '@/types/pitcher';
import { getDataset } from '@/lib/datasets';
import pitchersData from '@/data/pitchers.json';
import pitchersData2 from '@/data/pitchers2.json';
import pitchersData3 from '@/data/pitchers3.json';
import pitchersData4 from '@/data/pitchers4.json';
import pitchersData5 from '@/data/pitchers5.json';
import pitchersData6 from '@/data/pitchers6.json';

// Type assertion for the imported JSON
// Note: Minor league data may have fewer fields than MLB data
const pitchersMap: Record<string, Pitcher[]> = {
  'players.json': pitchersData as unknown as Pitcher[],
  'players2.json': pitchersData2 as unknown as Pitcher[],
  'players3.json': pitchersData3 as unknown as Pitcher[],
  'players4.json': pitchersData4 as unknown as Pitcher[],
  'players5.json': pitchersData5 as unknown as Pitcher[],
  'players6.json': pitchersData6 as unknown as Pitcher[]
};

function getPitchersByDataset(datasetId?: string): Pitcher[] {
  const dataset = getDataset(datasetId);
  return pitchersMap[dataset.dataFile] || [];
}

export function getAllPitchers(datasetId?: string): Pitcher[] {
  return getPitchersByDataset(datasetId);
}

export function getPitcherById(playerId: number, datasetId?: string): Pitcher | undefined {
  const pitchers = getPitchersByDataset(datasetId);
  return pitchers.find(p => p.player_id === playerId);
}

export function getPitcherByName(fullName: string, datasetId?: string): Pitcher | undefined {
  const pitchers = getPitchersByDataset(datasetId);
  return pitchers.find(p => p.full_name === fullName);
}

export function getPitchersByTeam(team: string, datasetId?: string): Pitcher[] {
  const pitchers = getPitchersByDataset(datasetId);
  return pitchers.filter(p => p.team === team);
}

export function searchPitchers(query: string, datasetId?: string): Pitcher[] {
  const pitchers = getPitchersByDataset(datasetId);
  const lowerQuery = query.toLowerCase();
  return pitchers.filter(p =>
    p.full_name?.toLowerCase().includes(lowerQuery) ||
    p.team?.toLowerCase().includes(lowerQuery)
  );
}

export function getPitcherTeams(datasetId?: string): string[] {
  const pitchers = getPitchersByDataset(datasetId);
  const teams = new Set(pitchers.map(p => p.team).filter(t => t !== null));
  return Array.from(teams).sort();
}

export function getPitcherStats(playerId: number, datasetId?: string): Pitcher | undefined {
  return getPitcherById(playerId, datasetId);
}
