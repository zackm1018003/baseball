export interface Dataset {
  id: string;
  name: string;
  dataFile: string;
}

export const DATASETS: Dataset[] = [
  {
    id: 'mlb2025',
    name: 'MLB 2025',
    dataFile: 'players.json'
  },
  {
    id: 'aaa2025',
    name: 'AAA 2025',
    dataFile: 'players2.json'
  }
];

export const DEFAULT_DATASET_ID = 'mlb2025';

export function getDatasetById(id: string): Dataset | undefined {
  return DATASETS.find(d => d.id === id);
}

export function getDataset(id?: string): Dataset {
  const dataset = id ? getDatasetById(id) : undefined;
  return dataset || getDatasetById(DEFAULT_DATASET_ID)!;
}
