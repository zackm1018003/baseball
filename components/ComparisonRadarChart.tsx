'use client';

import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer } from 'recharts';

interface ComparisonRadarChartProps {
  percentiles1: Record<string, number | null>;
  percentiles2: Record<string, number | null>;
  player1Name: string;
  player2Name: string;
}

export default function ComparisonRadarChart({
  percentiles1,
  percentiles2,
  player1Name,
  player2Name,
}: ComparisonRadarChartProps) {
  // Select key stats for radar chart
  const radarData = [
    {
      stat: 'Bat Speed',
      [player1Name]: percentiles1['bat_speed'] || 0,
      [player2Name]: percentiles2['bat_speed'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Avg EV',
      [player1Name]: percentiles1['avg_ev'] || 0,
      [player2Name]: percentiles2['avg_ev'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Barrel %',
      [player1Name]: percentiles1['barrel_%'] || 0,
      [player2Name]: percentiles2['barrel_%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Hard Hit %',
      [player1Name]: percentiles1['hard_hit%'] || 0,
      [player2Name]: percentiles2['hard_hit%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'BB %',
      [player1Name]: percentiles1['bb%'] || 0,
      [player2Name]: percentiles2['bb%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'K %',
      [player1Name]: percentiles1['k%'] || 0,
      [player2Name]: percentiles2['k%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Chase %',
      [player1Name]: percentiles1['chase%'] || 0,
      [player2Name]: percentiles2['chase%'] || 0,
      fullMark: 100,
    },
  ];

  return (
    <div className="w-full h-[400px] bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 text-center">
        Percentile Comparison
      </h3>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={radarData}>
          <PolarGrid stroke="#9ca3af" />
          <PolarAngleAxis
            dataKey="stat"
            tick={{ fill: '#6b7280', fontSize: 12 }}
          />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#6b7280' }} />
          <Radar
            name={player1Name}
            dataKey={player1Name}
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.5}
          />
          <Radar
            name={player2Name}
            dataKey={player2Name}
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.5}
          />
          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
