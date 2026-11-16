import {useState} from 'react';
import {ScrumProvider} from '../pm/lib/scrumState';
import Scrum from '../pm/pages/Scrum';
import Planning from '../pm/pages/Planning';
import SpentTime from '../pm/pages/SpentTime';
import PlanningResourceView from './PlanningResourceView';
import '../pm/pm.css';

const resourceTabs=[['overview','Overview'],['scrum','Scrum'],['planning','Planning'],['spent-time','Spent Time']] as const;
type ResourceTab=typeof resourceTabs[number][0];

export default function ResourceManagement({api}:{api:(path:string)=>Promise<any>}) {
  const params=new URLSearchParams(window.location.search);
  const taskView=params.get('view')==='sprint-tasks';
  const initial=params.get('tab');
  const [statsSlot,setStatsSlot]=useState<HTMLElement|null>(null);
  const [tab,setTab]=useState<ResourceTab>(resourceTabs.some(([id])=>id===initial)?initial as ResourceTab:'overview');
  const choose=(next:ResourceTab)=>{
    setTab(next);
    const url=new URL(window.location.href);
    if(next==='overview')url.searchParams.delete('tab');else url.searchParams.set('tab',next);
    window.history.replaceState(null,'',url);
  };

  if(taskView)return <ScrumProvider page="overview" statsSlot={null}><PlanningResourceView taskView api={api}/></ScrumProvider>;

  return <div className="resource-tabbed">
    <div className="resource-tabs-row">
      <nav className="resource-tabs" role="tablist" aria-label="Resource Management sections">
        {resourceTabs.map(([id,label])=><button key={id} role="tab" type="button" aria-selected={tab===id} className={`resource-tab${tab===id?' active':''}`} onClick={()=>choose(id)}>{label}</button>)}
      </nav>
      <div className="resource-tab-stats" ref={setStatsSlot}/>
    </div>
    <ScrumProvider page={tab} statsSlot={statsSlot}>
      <div hidden={tab!=='overview'}><PlanningResourceView api={api}/></div>
      <div className="pm-root" hidden={tab!=='scrum'}><Scrum/></div>
      <div className="pm-root" hidden={tab!=='planning'}><Planning/></div>
      <div className="pm-root" hidden={tab!=='spent-time'}><SpentTime/></div>
    </ScrumProvider>
  </div>;
}
