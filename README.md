# MLB Player Stat Database

A modern Next.js application for browsing and analyzing MLB player statistics. This application uses the data from the `henry` file and integrates with ESPN's API to display player images.

## Features

- **Player Database**: Browse 632+ MLB players with detailed statistics
- **Search Functionality**: Search players by name or team
- **Team Filtering**: Filter players by their team
- **Multiple Sort Options**: Sort by name, bat speed, exit velocity, hard hit %, or age
- **Player Details**: Click on any player to view comprehensive statistics including:
  - Swing Mechanics (Bat Speed, Swing Length, Attack Angle, etc.)
  - Contact Quality (Exit Velocity, Launch Angle, Barrel %, Hard Hit %)
  - Plate Discipline (Z-Swing %, Chase %, Whiff %)
  - Batted Ball Profile
- **ESPN Images**: Player headshots automatically loaded from ESPN's CDN
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## Technologies Used

- **Next.js 16** with App Router
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **ESPN API** for player images
- **React Hooks** for state management

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

### Building for Production

```bash
npm run build
npm start
```

## Data Source

The application uses the `henry` file located in the parent directory, which contains detailed swing and contact statistics for MLB players. The data is parsed and converted to JSON format during the build process.

## Project Structure

```
stat-database/
├── app/
│   ├── api/placeholder/       # Fallback image API
│   ├── player/[id]/          # Individual player pages
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Home page with player list
├── components/
│   └── PlayerCard.tsx        # Player card component
├── data/
│   └── players.json          # Parsed player data
├── lib/
│   ├── database.ts           # Data access utilities
│   └── espn.ts               # ESPN API integration
├── scripts/
│   └── parseData.js          # Data parsing script
└── types/
    └── player.ts             # TypeScript types
```

## Key Statistics

The database includes the following player statistics:

- **Swing Metrics**: Bat Speed, Fast Swing %, Swing Length, Attack Angle, Swing Tilt
- **Contact Metrics**: Average Exit Velocity, Average Launch Angle, Barrel %, Hard Hit %
- **Discipline Metrics**: Z-Swing %, Z-Whiff %, Chase %, O-Whiff %
- **Additional**: Age, Team, Player ID

## License

This project is for educational and demonstration purposes.
