import { Player } from '@/types/player';
import playersData from '@/data/players.json';

// Type assertion for the imported JSON
const players = playersData as Player[];

export function getAllPlayers(): Player[] {
  return players;
}

export function getPlayerById(playerId: number): Player | undefined {
  return players.find(p => p.player_id === playerId);
}

export function getPlayersByTeam(team: string): Player[] {
  return players.filter(p => p.team === team);
}

export function searchPlayers(query: string): Player[] {
  const lowerQuery = query.toLowerCase();
  return players.filter(p =>
    p.full_name?.toLowerCase().includes(lowerQuery) ||
    p.first_name?.toLowerCase().includes(lowerQuery) ||
    p.last_name?.toLowerCase().includes(lowerQuery) ||
    p.team?.toLowerCase().includes(lowerQuery)
  );
}

export function getTeams(): string[] {
  const teams = new Set(players.map(p => p.team).filter(t => t !== null));
  return Array.from(teams).sort();
}

export function getPlayerStats(playerId: number): Player | undefined {
  return getPlayerById(playerId);
}
