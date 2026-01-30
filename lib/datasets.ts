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
  },
  {
    id: 'aa2025',
    name: 'AA 2025',
    dataFile: 'players3.json'
  },
  {
    id: 'aplus2025',
    name: 'A+ 2025',
    dataFile: 'players4.json'
  },
  {
    id: 'a2025',
    name: 'A 2025',
    dataFile: 'players5.json'
  },
  {
    id: 'ncaa2025',
    name: 'NCAA 2025',
    dataFile: 'players6.json'
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
