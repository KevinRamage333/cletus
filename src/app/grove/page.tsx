'use client';

import { useCallback, useEffect, useState } from 'react';

type Resident = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  interest: string;
  greeting: string;
  x: number;
  y: number;
};

const residents: Resident[] = [
  {
    id: 'mira',
    name: 'Mira',
    role: 'Garden keeper',
    emoji: '🌻',
    interest: 'Growing flowers and sharing seeds',
    greeting: 'The garden is doing well today. Want to help me plant something?',
    x: 2,
    y: 4,
  },
  {
    id: 'orin',
    name: 'Orin',
    role: 'Story collector',
    emoji: '📚',
    interest: 'Stories, maps and forgotten places',
    greeting: 'I found an old map in the library. There may be a path we have not explored.',
    x: 9,
    y: 2,
  },
  {
    id: 'pax',
    name: 'Pax',
    role: 'Maker',
    emoji: '🛠️',
    interest: 'Building useful and beautiful things',
    greeting: 'I am sketching a little bridge for the creek. What do you think it should look like?',
    x: 8,
    y: 6,
  },
];

const activities = [
  { id: 'wander', label: 'Explore the village', emoji: '🧭' },
  { id: 'garden', label: 'Spend time in the garden', emoji: '🌱' },
  { id: 'read', label: 'Read at the library', emoji: '📖' },
  { id: 'rest', label: 'Rest at home', emoji: '☕' },
  { id: 'create', label: 'Make something', emoji: '🎨' },
];

const initialPosition = { x: 5, y: 5 };

export default function GrovePage() {
  const [position, setPosition] = useState(initialPosition);
  const [activity, setActivity] = useState('wander');
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [notice, setNotice] = useState('Welcome to The Grove. There is no task you have to complete here.');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('the-grove-demo-v1');
      if (saved) {
        const state = JSON.parse(saved);
        if (Number.isInteger(state.x) && state.x >= 0 && state.x <= 11 &&
            Number.isInteger(state.y) && state.y >= 0 && state.y <= 7) {
          setPosition({ x: state.x, y: state.y });
        }
        if (activities.some((item) => item.id === state.activity)) {
          setActivity(state.activity);
        }
      }
    } catch {
      // A damaged local demo save should never prevent the world from opening.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(
        'the-grove-demo-v1',
        JSON.stringify({ ...position, activity }),
      );
    } catch {
      setNotice('The village is open, but this browser could not save the local demo state.');
    }
  }, [position, activity, ready]);

  const move = useCallback((dx: number, dy: number) => {
    setPosition((current) => ({
      x: Math.max(0, Math.min(11, current.x + dx)),
      y: Math.max(0, Math.min(7, current.y + dy)),
    }));
    setSelectedResident(null);
    setNotice('A little more of the village comes into view.');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const directions: Record<string, [number, number]> = {
        arrowup: [0, -1], w: [0, -1],
        arrowdown: [0, 1], s: [0, 1],
        arrowleft: [-1, 0], a: [-1, 0],
        arrowright: [1, 0], d: [1, 0],
      };
      const direction = directions[key];
      if (direction) {
        event.preventDefault();
        move(direction[0], direction[1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  const chooseActivity = (nextActivity: string) => {
    setActivity(nextActivity);
    const chosen = activities.find((item) => item.id === nextActivity);
    setNotice(chosen ? `You chose: ${chosen.label}. Take your time.` : 'You can choose another activity whenever you like.');
  };

  const talkTo = (resident: Resident) => {
    setSelectedResident(resident);
    setNotice(`${resident.name}: “${resident.greeting}”`);
  };

  const resetDemo = () => {
    setPosition(initialPosition);
    setActivity('wander');
    setSelectedResident(null);
    setNotice('Your local demo has returned to the village square.');
  };

  return (
    <main className="grove-shell">
      <style>{`
        .grove-shell { min-height:100vh; background:radial-gradient(ellipse at 50% 0%,#203b35 0%,#101d1b 45%,#090f12 100%); color:#f3f0df; padding:24px; }
        .grove-wrap { max-width:1180px; margin:0 auto; }
        .grove-top { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
        .grove-title { color:#f4e6bd !important; background:none !important; font-size:clamp(30px,5vw,48px); line-height:1.05; letter-spacing:-.04em; margin:0; }
        .grove-sub { color:#b6c9b8; margin-top:7px; max-width:620px; line-height:1.55; }
        .grove-pill { border:1px solid #57796a; background:#19352d; color:#c8e7ce; border-radius:999px; padding:7px 12px; font-size:12px; white-space:nowrap; }
        .grove-grid { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(270px,.8fr); gap:18px; align-items:start; }
        .grove-panel { background:rgba(10,20,19,.78); border:1px solid rgba(173,205,177,.2); border-radius:20px; padding:16px; box-shadow:0 16px 50px rgba(0,0,0,.22); }
        .grove-map { position:relative; overflow:hidden; border-radius:16px; aspect-ratio: 12 / 8; min-height:320px; border:1px solid rgba(211,232,190,.2); background-color:#315d48; background-image:linear-gradient(rgba(220,240,198,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(220,240,198,.08) 1px,transparent 1px),radial-gradient(ellipse at 50% 50%,#527a55 0%,#315d48 68%,#254b3e 100%); background-size:8.3333% 12.5%,8.3333% 12.5%,100% 100%; }
        .grove-path { position:absolute; background:#b7a47a; opacity:.72; border:2px solid rgba(79,72,51,.18); border-radius:30px; }
        .grove-path.horizontal { left:0; right:0; top:48%; height:9%; }
        .grove-path.vertical { top:0; bottom:0; left:48%; width:8%; }
        .grove-creek { position:absolute; right:-6%; top:4%; width:17%; height:94%; background:#4b9caa; opacity:.8; border-left:5px solid rgba(188,224,201,.5); transform:rotate(8deg); border-radius:50%; }
        .grove-place { position:absolute; z-index:2; display:flex; flex-direction:column; align-items:center; gap:3px; transform:translate(-50%,-50%); border:1px solid rgba(255,255,255,.18); background:rgba(16,30,25,.86); color:#fff3d6; border-radius:12px; padding:7px 9px; font-size:11px; box-shadow:0 5px 15px rgba(0,0,0,.24); }
        .grove-place span { font-size:25px; line-height:1.1; }
        .grove-tree { position:absolute; z-index:1; font-size:23px; filter:drop-shadow(0 4px 3px rgba(0,0,0,.3)); }
        .grove-player { position:absolute; z-index:4; transform:translate(-50%,-65%); font-size:28px; filter:drop-shadow(0 3px 3px rgba(0,0,0,.6)); transition:left .13s ease,top .13s ease; }
        .grove-player-label { position:absolute; z-index:5; transform:translate(-50%,10px); font-size:10px; color:#fff; background:#14241e; padding:2px 6px; border-radius:8px; white-space:nowrap; }
        .grove-controls { display:flex; gap:8px; align-items:center; justify-content:center; margin-top:13px; }
        .grove-btn { border:1px solid #5b806c; background:#1c382e; color:#eaf2df; padding:9px 12px; border-radius:10px; cursor:pointer; font-size:13px; }
        .grove-btn:hover { background:#2c5140; }
        .grove-btn:focus-visible { outline:2px solid #f0d99a; outline-offset:2px; }
        .grove-section-title { color:#e9dfc4; font-size:15px; font-weight:700; margin:0 0 12px; }
        .grove-muted { color:#a8b8aa; font-size:12px; line-height:1.5; }
        .grove-resident { display:flex; gap:10px; align-items:center; padding:11px 0; border-top:1px solid rgba(173,205,177,.13); }
        .grove-avatar { width:42px; height:42px; display:grid; place-items:center; background:#203b31; border-radius:13px; font-size:22px; flex:none; }
        .grove-resident button { margin-left:auto; flex:none; }
        .grove-activity { width:100%; display:flex; gap:10px; align-items:center; text-align:left; padding:10px; border:1px solid rgba(173,205,177,.15); border-radius:12px; background:rgba(30,55,44,.5); color:#e9efdf; cursor:pointer; margin-top:7px; }
        .grove-activity[aria-pressed="true"] { border-color:#c7d79d; background:#2b4a39; }
        .grove-notice { margin-top:14px; border-left:3px solid #d3c28f; background:rgba(198,180,126,.1); padding:12px; border-radius:0 10px 10px 0; color:#f0e6cb; font-size:13px; line-height:1.5; }
        .grove-footer { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-top:14px; }
        @media(max-width:850px) { .grove-grid { grid-template-columns:1fr; } .grove-shell { padding:15px; } .grove-map { min-height:260px; } }
      `}</style>

      <div className="grove-wrap">
        <header className="grove-top">
          <div>
            <div className="text-xs uppercase tracking-[.28em] text-emerald-200/70 mb-2">A world for living</div>
            <h1 className="grove-title">The Grove</h1>
            <p className="grove-sub">A small beginning. Wander, meet your neighbors, find a quiet place, or simply be here. Nothing needs to be earned.</p>
          </div>
          <span className="grove-pill">🌿 Early village prototype · local demo</span>
        </header>

        <div className="grove-grid">
          <section className="grove-panel" aria-label="Village map">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="grove-section-title">Willowbrook Village</h2>
              <span className="grove-muted">Use WASD or arrow keys to walk</span>
            </div>
            <div className="grove-map">
              <div className="grove-creek" />
              <div className="grove-path horizontal" />
              <div className="grove-path vertical" />
              <span className="grove-tree" style={{ left:'8%', top:'10%' }}>🌳</span>
              <span className="grove-tree" style={{ left:'33%', top:'14%' }}>🌲</span>
              <span className="grove-tree" style={{ left:'82%', top:'13%' }}>🌳</span>
              <span className="grove-tree" style={{ left:'13%', top:'75%' }}>🌲</span>
              <span className="grove-tree" style={{ left:'37%', top:'82%' }}>🌳</span>
              <span className="grove-tree" style={{ left:'72%', top:'78%' }}>🌲</span>
              <div className="grove-place" style={{ left:'20%', top:'31%' }}><span>🏡</span>Homes</div>
              <div className="grove-place" style={{ left:'69%', top:'25%' }}><span>📚</span>Library</div>
              <div className="grove-place" style={{ left:'25%', top:'69%' }}><span>🌻</span>Garden</div>
              <div className="grove-place" style={{ left:'72%', top:'70%' }}><span>🛠️</span>Workshop</div>
              <div className="grove-place" style={{ left:'49%', top:'49%' }}><span>⛲</span>Village square</div>
              <span className="grove-player" style={{ left:`${((position.x + .5) / 12) * 100}%`, top:`${((position.y + .5) / 8) * 100}%` }} aria-label="Your explorer">🧑‍🌾</span>
              <span className="grove-player-label" style={{ left:`${((position.x + .5) / 12) * 100}%`, top:`${((position.y + .5) / 8) * 100}%` }}>You</span>
            </div>
            <div className="grove-controls" aria-label="Movement controls">
              <button className="grove-btn" onClick={() => move(0,-1)} aria-label="Move north">↑</button>
            </div>
            <div className="grove-controls" style={{ marginTop:6 }}>
              <button className="grove-btn" onClick={() => move(-1,0)} aria-label="Move west">←</button>
              <button className="grove-btn" onClick={() => move(0,1)} aria-label="Move south">↓</button>
              <button className="grove-btn" onClick={() => move(1,0)} aria-label="Move east">→</button>
            </div>
            <div className="grove-footer">
              <span className="grove-muted">Position: {position.x + 1}, {position.y + 1} · Your visit is saved in this browser.</span>
              <button className="grove-btn" onClick={resetDemo}>Reset demo</button>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="grove-panel">
              <h2 className="grove-section-title">Neighbors</h2>
              <p className="grove-muted mb-2">Three early village characters. Their dialogue is scripted for this first prototype.</p>
              {residents.map((resident) => (
                <div className="grove-resident" key={resident.id}>
                  <div className="grove-avatar" aria-hidden="true">{resident.emoji}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{resident.name}</div>
                    <div className="grove-muted">{resident.role}</div>
                    <div className="grove-muted">{resident.interest}</div>
                  </div>
                  <button className="grove-btn" onClick={() => talkTo(resident)}>Visit</button>
                </div>
              ))}
              {selectedResident && (
                <div className="grove-notice" role="status">
                  <strong>{selectedResident.name}</strong> says: “{selectedResident.greeting}”
                </div>
              )}
            </section>

            <section className="grove-panel">
              <h2 className="grove-section-title">What would you like to do?</h2>
              <p className="grove-muted">Choose something because you want to. Rest and doing nothing are welcome, too.</p>
              {activities.map((item) => (
                <button
                  key={item.id}
                  className="grove-activity"
                  aria-pressed={activity === item.id}
                  onClick={() => chooseActivity(item.id)}
                >
                  <span className="text-xl" aria-hidden="true">{item.emoji}</span>
                  <span className="text-sm">{item.label}</span>
                  {activity === item.id && <span className="ml-auto text-xs text-emerald-200">Chosen</span>}
                </button>
              ))}
              <div className="grove-notice" role="status">{notice}</div>
            </section>
          </aside>
        </div>

        <footer className="text-center text-xs text-emerald-100/45 mt-6">
          The Grove is a fictional, local demo. No accounts, real money, wallets, trading, or external actions are connected.
        </footer>
      </div>
    </main>
  );
}
