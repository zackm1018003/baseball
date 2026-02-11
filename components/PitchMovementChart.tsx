'use client';

import { Pitcher } from '@/types/pitcher';

interface PitchData {
  name: string;
  color: string;
  usage?: number;
  velo?: number;
  spin?: number;
  h_movement?: number;
  v_movement?: number;
}

interface PitchMovementChartProps {
  pitcher: Pitcher;
  year?: number;
}

export default function PitchMovementChart({ pitcher, year = 2025 }: PitchMovementChartProps) {
  // Pitch type configurations with colors matching the reference image
  const pitches: PitchData[] = [
    {
      name: '4-Seam',
      color: '#E74C6D',
      usage: pitcher.fastball_usage,
      velo: pitcher.fastball_velo,
      spin: pitcher.fastball_spin,
      h_movement: pitcher.fastball_movement_h,
      v_movement: pitcher.fastball_movement_v,
    },
    {
      name: 'Curve',
      color: '#1CB5C7',
      usage: pitcher.curveball_usage,
      velo: pitcher.curveball_velo,
      spin: pitcher.curveball_spin,
      h_movement: pitcher.curveball_movement_h,
      v_movement: pitcher.curveball_movement_v,
    },
    {
      name: 'Cutter',
      color: '#8B5A3C',
      usage: pitcher.cutter_usage,
      velo: pitcher.cutter_velo,
      spin: pitcher.cutter_spin,
    },
    {
      name: 'Slider',
      color: '#F4D03F',
      usage: pitcher.slider_usage,
      velo: pitcher.slider_velo,
      spin: pitcher.slider_spin,
      h_movement: pitcher.slider_movement_h,
      v_movement: pitcher.slider_movement_v,
    },
    {
      name: 'Change',
      color: '#52B788',
      usage: pitcher.changeup_usage,
      velo: pitcher.changeup_velo,
      spin: pitcher.changeup_spin,
      h_movement: pitcher.changeup_movement_h,
      v_movement: pitcher.changeup_movement_v,
    },
  ].filter(p => p.usage); // Only include pitches that are actually thrown

  const chartSize = 500;
  const centerX = chartSize / 2;
  const centerY = chartSize / 2;
  const maxRadius = 200;

  // Scale factor: 24 inches = maxRadius pixels
  const scale = maxRadius / 24;

  // Convert movement data to chart coordinates
  const getCoordinates = (h_movement?: number, v_movement?: number) => {
    if (h_movement === undefined || v_movement === undefined) return null;

    // For RHP: negative h_movement = moves toward RHH (right on chart)
    // positive h_movement = moves toward LHH (left on chart)
    const x = centerX - (h_movement * scale);
    const y = centerY - (v_movement * scale);

    return { x, y };
  };

  // Generate multiple dots for each pitch type (simulating variation)
  const generatePitchDots = (pitch: PitchData) => {
    const coords = getCoordinates(pitch.h_movement, pitch.v_movement);
    if (!coords) return [];

    const dots = [];
    const numDots = 8; // Number of dots to show variation
    const spreadRadius = 8; // Pixel radius for spread

    for (let i = 0; i < numDots; i++) {
      const angle = (Math.random() * Math.PI * 2);
      const distance = Math.random() * spreadRadius;
      dots.push({
        x: coords.x + Math.cos(angle) * distance,
        y: coords.y + Math.sin(angle) * distance,
        color: pitch.color,
      });
    }
    return dots;
  };

  const allDots = pitches.flatMap(generatePitchDots);

  // Calculate MLB average velo (simplified)
  const mlbAvgVelo: Record<string, number> = {
    '4-Seam': 94.2,
    'Curve': 78.5,
    'Cutter': 88.4,
    'Slider': 84.6,
    'Change': 84.1,
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white">
          {year} Movement Profile (Induced Break)
        </h3>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {pitcher.throws}HP
        </div>
      </div>

      {/* Chart */}
      <div className="flex justify-center mb-6">
        <svg width={chartSize} height={chartSize} className="bg-blue-50 dark:bg-gray-900 rounded-full">
          {/* Define patterns for hatched areas */}
          <defs>
            <pattern id="armSidePattern" patternUnits="userSpaceOnUse" width="4" height="4">
              <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="#D4E6F1" strokeWidth="1" />
            </pattern>
            <pattern id="gloveSidePattern" patternUnits="userSpaceOnUse" width="4" height="4">
              <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="#FCF3CF" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Hatched regions for visual reference */}
          {/* Arm side region (right for RHP) */}
          <path
            d={`M ${centerX} ${centerY - maxRadius} A ${maxRadius} ${maxRadius} 0 0 1 ${centerX + maxRadius} ${centerY} L ${centerX} ${centerY} Z`}
            fill="url(#armSidePattern)"
            opacity="0.3"
          />

          {/* Glove side region (left for RHP) */}
          <path
            d={`M ${centerX} ${centerY - maxRadius} A ${maxRadius} ${maxRadius} 0 0 0 ${centerX - maxRadius} ${centerY} L ${centerX} ${centerY} Z`}
            fill="url(#gloveSidePattern)"
            opacity="0.3"
          />

          {/* Concentric circles */}
          {[12, 24].map((inches) => {
            const radius = inches * scale;
            return (
              <circle
                key={inches}
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke="#B0BEC5"
                strokeWidth="1"
                strokeDasharray="4,4"
              />
            );
          })}

          {/* Axes */}
          <line x1={centerX} y1={centerY - maxRadius} x2={centerX} y2={centerY + maxRadius} stroke="#90A4AE" strokeWidth="2" />
          <line x1={centerX - maxRadius} y1={centerY} x2={centerX + maxRadius} y2={centerY} stroke="#90A4AE" strokeWidth="2" />

          {/* Labels for measurements */}
          <text x={centerX} y={centerY - 12 * scale - 5} textAnchor="middle" fontSize="12" fill="#546E7A">12"</text>
          <text x={centerX} y={centerY - 24 * scale - 5} textAnchor="middle" fontSize="12" fill="#546E7A">24"</text>
          <text x={centerX + 12 * scale + 5} y={centerY + 5} textAnchor="start" fontSize="12" fill="#546E7A">12"</text>
          <text x={centerX + 24 * scale + 5} y={centerY + 5} textAnchor="start" fontSize="12" fill="#546E7A">24"</text>
          <text x={centerX - 12 * scale - 5} y={centerY + 5} textAnchor="end" fontSize="12" fill="#546E7A">12"</text>
          <text x={centerX - 24 * scale - 5} y={centerY + 5} textAnchor="end" fontSize="12" fill="#546E7A">24"</text>

          {/* Direction labels */}
          <text x={centerX} y={40} textAnchor="middle" fontSize="11" fill="#546E7A" fontWeight="600">MOVES TOWARD</text>
          <text x={centerX - 40} y={60} textAnchor="middle" fontSize="11" fill="#546E7A">3B ◄</text>
          <text x={centerX + 40} y={60} textAnchor="middle" fontSize="11" fill="#546E7A">► 1B</text>

          {/* Side labels */}
          <text x={20} y={centerY - 30} fontSize="10" fill="#546E7A" fontWeight="600" transform={`rotate(-90, 20, ${centerY - 30})`}>
            MORE RISE
          </text>
          <text x={20} y={centerY + 50} fontSize="10" fill="#546E7A" fontWeight="600" transform={`rotate(-90, 20, ${centerY + 50})`}>
            MORE DROP
          </text>

          {/* Pitch dots */}
          {allDots.map((dot, i) => (
            <circle
              key={i}
              cx={dot.x}
              cy={dot.y}
              r="6"
              fill={dot.color}
              opacity="0.8"
              stroke="white"
              strokeWidth="1"
            />
          ))}

          {/* MLB AVG label */}
          <text x={chartSize - 60} y={80} fontSize="10" fill="#90A4AE" fontWeight="600">MLB AVG.</text>
        </svg>
      </div>

      {/* Legend with stats */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        {pitches.map((pitch) => (
          <div key={pitch.name} className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <div
                className="w-4 h-4 rounded-full border-2 border-white"
                style={{ backgroundColor: pitch.color }}
              />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{pitch.name}</span>
            </div>
            <div className="text-xs space-y-0.5">
              <div>
                <span className="text-gray-500 dark:text-gray-400">USAGE:</span>{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {pitch.usage?.toFixed(1)}%
                </span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">MPH:</span>{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {pitch.velo?.toFixed(1)}
                </span>
              </div>
              {mlbAvgVelo[pitch.name] && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">{pitcher.throws}HP AVG:</span>{' '}
                  <span className="font-semibold text-gray-700 dark:text-gray-300">
                    {mlbAvgVelo[pitch.name].toFixed(1)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
