import { Player } from '@/types/player';
import { getDataset } from '@/lib/datasets';
import playersData from '@/data/players.json';
import playersData2 from '@/data/players2.json';

// Type assertion for the imported JSON
// Note: AAA data may have fewer fields than MLB data
const playersMap: Record<string, Player[]> = {
  'players.json': playersData as Player[],
  'players2.json': playersData2 as unknown as Player[]
};

function getPlayersByDataset(datasetId?: string): Player[] {
  const dataset = getDataset(datasetId);
  return playersMap[dataset.dataFile] || [];
}

export function getAllPlayers(datasetId?: string): Player[] {
  return getPlayersByDataset(datasetId);
}

export function getPlayerById(playerId: number, datasetId?: string): Player | undefined {
  const players = getPlayersByDataset(datasetId);
  return players.find(p => p.player_id === playerId);
}

export function getPlayersByTeam(team: string, datasetId?: string): Player[] {
  const players = getPlayersByDataset(datasetId);
  return players.filter(p => p.team === team);
}

export function searchPlayers(query: string, datasetId?: string): Player[] {
  const players = getPlayersByDataset(datasetId);
  const lowerQuery = query.toLowerCase();
  return players.filter(p =>
    p.full_name?.toLowerCase().includes(lowerQuery) ||
    p.first_name?.toLowerCase().includes(lowerQuery) ||
    p.last_name?.toLowerCase().includes(lowerQuery) ||
    p.team?.toLowerCase().includes(lowerQuery)
  );
}

export function getTeams(datasetId?: string): string[] {
  const players = getPlayersByDataset(datasetId);
  const teams = new Set(players.map(p => p.team).filter(t => t !== null));
  return Array.from(teams).sort();
}

export function getPlayerStats(playerId: number, datasetId?: string): Player | undefined {
  return getPlayerById(playerId, datasetId);
}
