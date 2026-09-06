import { useState } from 'react';
import { ArrowRight, Database, MapPinned, Play, Route, Search, Settings2, Upload } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import type { Run } from '../api/client';

export function HomePage() {
  const s = useAppStore();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'capacity' | 'diversion'>('all');
  const corridor = s.corridors.find(c => c.id === s.selectedCorridorId);
  const dataset = s.uploads.find(u => u.id === s.selectedUploadId);
  const jobs = [...s.runs].sort((a, b) => b.id - a.id).filter(r =>
    (mode === 'all' || r.model_type === mode) && `${r.id} ${r.name} ${r.traction}`.toLowerCase().includes(query.toLowerCase()));
  const openRun = (run: Run) => { s.selectRun(run.id); s.setPage(run.status === 'complete' ? 'results' : 'runs'); };
  const begin = (type: 'capacity' | 'diversion') => { s.setPendingModelType(type); s.setPage('upload'); };

  return <div className="rail-workspace">
    <div className="workspace-heading"><div><span className="section-label">RAILWAY PLANNING / STUDIES</span><h1>Study workspace</h1><p>Capacity assessment and freight diversion planning</p></div><button className="accent" onClick={() => begin('capacity')}><Play size={15} /> New capacity study</button></div>
    <div className="workspace-context">
      <button onClick={() => s.setPage('corridor')}><MapPinned size={18} /><span><small>Selected corridor</small><strong>{corridor?.name ?? 'Select a corridor'}</strong></span><ArrowRight size={14}/></button>
      <button onClick={() => s.setPage('upload')}><Database size={18}/><span><small>Selected input</small><strong>{dataset?.original_name ?? 'Select a TD dataset'}</strong></span><ArrowRight size={14}/></button>
      <div><span><small>Analysis engine</small><strong className={s.online ? 'engine-ready' : 'engine-unavailable'}>{s.online ? 'Connected' : 'Disconnected'}</strong></span></div>
    </div>
    <div className="workspace-columns">
      <section className="study-register">
        <header><h2>Study register <span>{s.runs.length}</span></h2><button className="ghost" onClick={() => s.setPage('runs')}>Run monitor <ArrowRight size={14}/></button></header>
        <div className="register-toolbar"><div className="register-tabs" aria-label="Filter studies">{(['all','capacity','diversion'] as const).map(t => <button key={t} aria-pressed={mode === t} className={mode === t ? 'selected' : ''} onClick={() => setMode(t)}>{t === 'all' ? 'All studies' : t === 'capacity' ? 'Capacity' : 'Diversion'}</button>)}</div><label className="register-search"><Search size={14}/><input aria-label="Search studies" placeholder="Find study, ID or traction…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
        <div className="register-scroll"><table><thead><tr><th>Study / reference</th><th>Model</th><th>Service date</th><th>Status</th><th>Paths placed</th><th>Action</th></tr></thead><tbody>{jobs.map(r => <tr key={r.id}><td><button className="study-link" onClick={() => openRun(r)}>{r.name}</button><small>RUN {String(r.id).padStart(4,'0')} · {r.traction || 'Traction not set'}</small></td><td>{r.model_type === 'capacity' ? 'Capacity' : 'Diversion'}</td><td>{r.date_tag || 'All dates'}</td><td><span className={`study-status ${r.status}`}>{r.status}</span></td><td className="numeric">{r.status === 'complete' ? r.model_type === 'diversion' ? r.div_placed ?? '—' : (r.up_inserted ?? 0) + (r.down_inserted ?? 0) : '—'}</td><td><button className="secondary" onClick={() => openRun(r)}>{r.status === 'complete' ? 'Inspect' : 'Monitor'}<ArrowRight size={12}/></button></td></tr>)}</tbody></table>
        {!jobs.length && <div className="register-empty"><Route size={30}/><h3>{s.runs.length ? 'No matching studies' : 'Start your first study'}</h3><p>{s.runs.length ? 'Change the model filter or search text.' : 'Import train describer data, choose a corridor and configure the model.'}</p>{!s.runs.length && <button onClick={() => begin('capacity')}><Upload size={14}/> Import TD data</button>}</div>}</div>
        <footer>{jobs.length} studies shown <span>{s.runs.filter(r => r.status === 'running' || r.status === 'pending').length} queued or running</span></footer>
      </section>
      <aside className="workspace-inspector"><h2>Planning tools</h2><button onClick={() => begin('capacity')}><Play size={18}/><span><strong>Capacity assessment</strong><small>Find additional feasible train paths</small></span><ArrowRight size={14}/></button><button onClick={() => begin('diversion')}><Route size={18}/><span><strong>Freight diversion</strong><small>Assess alternative corridor capacity</small></span><ArrowRight size={14}/></button><button onClick={() => s.setPage('configure')}><Settings2 size={18}/><span><strong>Model configuration</strong><small>Headways, traction and operating hours</small></span><ArrowRight size={14}/></button>
      <h2>Workspace inventory</h2><dl><div><dt>TD datasets</dt><dd>{s.uploads.length}</dd></div><div><dt>Corridor definitions</dt><dd>{s.corridors.length}</dd></div><div><dt>Completed studies</dt><dd>{s.runs.filter(r => r.status === 'complete').length}</dd></div></dl><button onClick={() => s.setPage('tpr')}><span><strong>Train Planning Rules</strong><small>Allowances, runtime adjustments and loops</small></span><ArrowRight size={14}/></button></aside>
    </div>
  </div>;
}
