import { BookOpen, Database, FolderOpen, MapPinned, Play, Route, Settings2, Table2, Upload } from 'lucide-react';
import { Page, useAppStore } from '../../stores/appStore';

const modules: { page: Page; title: string; short: string; Icon: typeof Route }[] = [
  { page: 'home', title: 'Home', short: 'Studies', Icon: FolderOpen },
  { page: 'upload', title: 'Upload TD data', short: 'Data', Icon: Database },
  { page: 'corridor', title: 'Corridor', short: 'Network', Icon: MapPinned },
  { page: 'configure', title: 'Configure run', short: 'Model', Icon: Settings2 },
  { page: 'runs', title: 'Runs', short: 'Solve', Icon: Play },
  { page: 'results', title: 'Results', short: 'Results', Icon: Table2 },
  { page: 'tpr', title: 'TPR Library', short: 'Rules', Icon: BookOpen },
];

export function Sidebar() {
  const page = useAppStore(s => s.page);
  const setPage = useAppStore(s => s.setPage);
  return <aside className="app-sidebar rail-dock"><div className="rail-emblem"><img src="/rail-insights-mark.svg" alt="Rail Insights"/></div><nav aria-label="Planning modules">{modules.map(({page: id, title, short, Icon}) => <button key={id} title={title} aria-label={title} aria-current={id === page ? 'page' : undefined} className={`sidebar-nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><Icon size={20}/><span>{short}</span><span className="sr-only">{title}</span></button>)}</nav><div className="dock-caption"><img className="dock-ljmu-logo" src="/ljmu-logo.png" alt="Liverpool John Moores University" title="Liverpool John Moores University" /></div></aside>;
}

export function Header() {
  const s = useAppStore();
  const start = (type: 'capacity' | 'diversion') => { s.setPendingModelType(type); s.setPage('upload'); };
  return <header className="app-header rail-commandbar"><div className="rail-menuline"><strong>Rail Insights <span>Railway planning</span></strong></div><div className="rail-toolline"><span className="rail-module-name">{modules.find(m => m.page === s.page)?.short}</span><button onClick={() => start('capacity')}><Play size={14}/> New capacity study</button><button onClick={() => start('diversion')}><Route size={14}/> New diversion</button><i/><button onClick={() => s.setPage('upload')}><Upload size={14}/> Import data</button><button onClick={() => s.setPage('corridor')}><MapPinned size={14}/> Edit corridor</button><button onClick={() => s.setPage('configure')}><Settings2 size={14}/> Parameters</button></div></header>;
}
