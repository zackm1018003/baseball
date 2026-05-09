'use client';

import { useState } from 'react';

const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];
const TYPES = ['hit', 'pitch'];

export default function SyncPage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  function addLog(msg: string) {
    setLog(prev => [...prev, msg]);
  }

  // Bookmarklet code — runs on overslotbaseball.com to extract table data
  const bookmarkletCode = (type: string, year: string) => {
    const importUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/api/import-stats`
      : '/api/import-stats';
    return `javascript:(function(){
  var rows=[];
  var thead=document.querySelector('thead');
  var keys=[...thead.querySelectorAll('[data-key]')].map(el=>el.getAttribute('data-key'));
  var cols=[];
  var HIT_MAP={'player_name':'Player','team_name':'Team','hit_games_played':'G','hit_plate_appearances':'PA','hit_hits':'H','hit_singles':'1B','hit_doubles':'2B','hit_triples':'3B','hit_hrs':'HR','hit_runs':'R','hit_base_on_balls':'BB','hit_strikeouts':'SO','hit_hit_by_pitch':'HBP','hit_stolen_bases':'SB','hit_caught_stealing':'CS','hit_ba':'BA','hit_obp':'OBP','hit_slg':'SLG','hit_ops':'OPS','hit_iso':'ISO','hit_babip':'BABIP','hit_woba':'wOBA'};
  var PIT_MAP={'player_name':'Player','team_name':'Team','pitch_appearances':'G','pitch_games_started':'GS','pitch_innings_pitched':'IP','pitch_batters_faced':'BF','pitch_hits':'H','pitch_runs':'R','pitch_base_on_balls':'BB','pitch_strikeouts':'SO','pitch_hit_by_pitch':'HBP','pitch_whip':'WHIP','pitch_ba':'BA','pitch_obp':'OBP','pitch_slg':'SLG','pitch_ops':'OPS','pitch_babip':'BABIP','pitch_walk_rate':'BB%','pitch_strikeout_rate':'K%','pitch_bb_k':'BB/K','pitch_fip':'FIP','pitch_xfip':'xFIP','pitch_siera':'SIERA'};
  var MAP=${type === 'hit' ? 'HIT_MAP' : 'PIT_MAP'};
  cols=keys.map(function(k){return MAP[k]||k;}).filter(Boolean);
  document.querySelectorAll('tbody tr').forEach(function(tr){
    var vals=[...tr.querySelectorAll('[data-value]')].map(function(td){return td.getAttribute('data-value');});
    var href=tr.querySelector('a[href*="/players/"]');
    var playerUrl=href?href.getAttribute('href'):'';
    var row={playerUrl:playerUrl};
    keys.forEach(function(k,i){if(MAP[k])row[MAP[k]]=vals[i]||'';});
    if(row['Player'])rows.push(row);
  });
  if(rows.length<10){alert('Only '+rows.length+' rows found. Make sure you are on the stats page with all players loaded.');return;}
  fetch('${importUrl}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({players:rows,cols:cols,type:'${type}',year:'${year}'})})
    .then(function(r){return r.json();})
    .then(function(d){alert('Synced '+d.players+' players for ${type} ${year}!');})
    .catch(function(e){alert('Error: '+e);});
})();`;
  };

  async function runAllSyncs() {
    setRunning(true);
    setLog([]);
    addLog('Starting sync via local machine (bypasses Cloudflare)...');

    for (const type of TYPES) {
      for (const year of YEARS) {
        try {
          addLog(`Fetching ${type} ${year}...`);
          const res = await fetch(`/api/overslot-stats?type=${type}&year=${year}&fresh=1`);
          const d = await res.json();
          if (d.players?.length >= 20) {
            const imp = await fetch('/api/import-stats', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ players: d.players, cols: d.cols, type, year }),
            });
            const r = await imp.json();
            addLog(`✓ ${type} ${year}: ${r.players} players cached`);
          } else {
            addLog(`⚠ ${type} ${year}: only ${d.players?.length} players (Cloudflare blocked — use bookmarklet instead)`);
          }
        } catch (e) {
          addLog(`✗ ${type} ${year}: ${e}`);
        }
      }
    }
    addLog('Done! Reload the stats page to see full data.');
    setRunning(false);
  }

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Data Sync</h1>
      <p className="text-gray-400 text-sm mb-8">
        Cloudflare blocks Vercel&apos;s servers from getting full player data. Use one of the methods below to seed the cache from your browser.
      </p>

      {/* Method 1: Auto sync (only works on local dev) */}
      <div className="bg-[#141414] rounded-xl border border-[#262626] p-5 mb-6">
        <h2 className="font-bold text-white mb-1">Method 1 — Auto Sync <span className="text-xs text-amber-400 ml-2">(local dev only)</span></h2>
        <p className="text-gray-400 text-xs mb-4">Run this from <code className="text-white">localhost:3000/sync</code>. Fetches all years via your IP and caches server-side.</p>
        <button
          onClick={runAllSyncs}
          disabled={running}
          className="px-4 py-2 bg-white text-black rounded font-medium text-sm disabled:opacity-50"
        >
          {running ? 'Syncing…' : 'Sync All Years'}
        </button>
        {log.length > 0 && (
          <div className="mt-4 bg-[#0a0a0a] rounded p-3 font-mono text-xs space-y-1">
            {log.map((l, i) => <div key={i} className="text-gray-300">{l}</div>)}
          </div>
        )}
      </div>

      {/* Method 2: Bookmarklets */}
      <div className="bg-[#141414] rounded-xl border border-[#262626] p-5">
        <h2 className="font-bold text-white mb-1">Method 2 — Bookmarklets <span className="text-xs text-green-400 ml-2">(works from any browser)</span></h2>
        <p className="text-gray-400 text-xs mb-4">
          Drag a button below to your bookmarks bar. Then visit <a href="https://overslotbaseball.com/stats/hit/2026/" target="_blank" rel="noopener noreferrer" className="text-white underline">overslot stats page</a> and click the bookmark to sync that year.
        </p>
        <div className="space-y-3">
          {TYPES.map(type => (
            <div key={type}>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">{type === 'hit' ? 'Hitting' : 'Pitching'}</div>
              <div className="flex flex-wrap gap-2">
                {YEARS.map(year => (
                  <a
                    key={year}
                    href={bookmarkletCode(type, year)}
                    className="px-3 py-1.5 bg-[#1c1c1c] border border-[#333] rounded text-xs text-white hover:bg-[#252525] cursor-grab"
                    onClick={e => e.preventDefault()}
                    title={`Drag to bookmarks bar, then click on overslotbaseball.com/stats/${type}/${year}/`}
                  >
                    📊 Sync {type} {year}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-gray-600 text-xs mt-4">⚠ Don&apos;t click — drag to bookmarks bar, then use on overslotbaseball.com</p>
      </div>
    </div>
  );
}
