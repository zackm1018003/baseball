import { Player } from '@/types/player';
import { getDataset } from '@/lib/datasets';
import playersData from '@/data/players.json';
import playersData2 from '@/data/players2.json';
import playersData3 from '@/data/players3.json';
import playersData4 from '@/data/players4.json';
import playersData5 from '@/data/players5.json';
import playersData6 from '@/data/players6.json';

// Type assertion for the imported JSON
// Note: Minor league data may have fewer fields than MLB data
const playersMap: Record<string, Player[]> = {
  'players.json': playersData as unknown as Player[],
  'players2.json': playersData2 as unknown as Player[],
  'players3.json': playersData3 as unknown as Player[],
  'players4.json': playersData4 as unknown as Player[],
  'players5.json': playersData5 as unknown as Player[],
  'players6.json': playersData6 as unknown as Player[]
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

export function getPlayerByName(fullName: string, datasetId?: string): Player | undefined {
  const players = getPlayersByDataset(datasetId);
  return players.find(p => p.full_name === fullName);
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
