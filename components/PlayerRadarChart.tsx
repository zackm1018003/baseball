'use client';

import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer } from 'recharts';

interface PlayerRadarChartProps {
  percentiles: Record<string, number | null>;
  playerName: string;
}

export default function PlayerRadarChart({ percentiles, playerName }: PlayerRadarChartProps) {
  // Select key stats for radar chart
  const radarData = [
    {
      stat: 'Bat Speed',
      value: percentiles['bat_speed'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Avg EV',
      value: percentiles['avg_ev'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Barrel %',
      value: percentiles['barrel_%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Swing Length',
      value: percentiles['swing_length'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Z-Swing %',
      value: percentiles['z-swing%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Z-Whiff %',
      value: percentiles['z-whiff%'] || 0,
      fullMark: 100,
    },
    {
      stat: 'Chase %',
      value: percentiles['chase%'] || 0,
      fullMark: 100,
    },
  ];

  return (
    <div className="w-full h-[400px] bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 text-center">
        {playerName} - Percentile Profile
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
            name={playerName}
            dataKey="value"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.6}
          />
          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
