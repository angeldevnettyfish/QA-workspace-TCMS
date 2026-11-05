import {useEffect, useState, useCallback, useRef} from 'react';
import {createPortal} from 'react-dom';
import {History as HistoryIcon, CalendarClock} from 'lucide-react';
import AutomationSchedules from './AutomationSchedules';
import {Panel, Table, Field, SelectField} from '../components/ui';
import HtmlReportViewer from '../components/HtmlReportViewer';
import AutomationHistoryMatrix, {type HistoryRun} from '../components/AutomationHistoryMatrix';

type Row = Record<string, any>;
type Api = (path:string, options?:RequestInit)=>Promise<any>;
function runOutcome(run:Row) {
  if(run.result==='SUCCESSFUL')return {label:'Passed',tone:'passed'};
  if(run.result==='FAILED'||run.result==='ERROR')return {label:'Failed',tone:'failed'};
  if(run.result==='STOPPED')return {label:'Stopped',tone:'neutral'};
  if(run.state==='IN_PROGRESS')return {label:'Running',tone:'running'};
  if(run.state==='PENDING'||run.state==='TRIGGERING')return {label:'Pending',tone:'neutral'};
  return {label:run.state==='DISPATCH_UNCONFIRMED'?'Not confirmed':'Unknown',tone:'neutral'};
}
function runTime(value:string) {
  if(!value)return '—';
  const date=new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)?value:value+'Z');
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}
export default function AutomationRunner({projectId, cycleId, cycles, canLead, api, onReport, headerActions}: {
  projectId:number; cycleId:number; cycles:Row[]; canLead:boolean; api:Api; onReport:()=>void; headerActions:HTMLElement|null;
}) {
  const [config,setConfig]=useState({workspace:'',repository:'',branch:'main',pipeline:'qa-automation'});
  const [ready,setReady]=useState<Row>({});
  const [runs,setRuns]=useState<(Row & HistoryRun)[]>([]);
  const [selectedCycle,setSelectedCycle]=useState(cycleId);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [viewReport,setViewReport]=useState<Row|null>(null);
  const [showHistory,setShowHistory]=useState(false);
  const [showSchedules,setShowSchedules]=useState(false);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState('');
  const historyDialog=useRef<HTMLDialogElement>(null);
  const recentRuns=runs.slice(0,10);
  useEffect(()=>{
    const dialog=historyDialog.current;
    if(showHistory&&!dialog?.open)dialog?.showModal();
    if(!showHistory&&dialog?.open)dialog.close();
  },[showHistory]);
  const reportPanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(viewReport)reportPanel.current?.scrollIntoView({behavior:'instant',block:'start'});
  },[viewReport]);
  const load=useCallback(async()=>setRuns(await api(`/automation/runs?project_id=${projectId}`)),[api,projectId]);
  useEffect(()=>{let cancelled=false;
    void api(`/automation/bitbucket?project_id=${projectId}`).then(result=>{
      if(cancelled)return;
      setReady(result);if(result.config)setConfig(result.config);
    }).catch(e=>{if(!cancelled)setError(String(e));});
    void load().catch(e=>{if(!cancelled)setError(String(e));});
    return ()=>{cancelled=true;};
  },[api,projectId,load]);
  useEffect(()=>setSelectedCycle(cycleId),[cycleId]);
  useEffect(()=>{let cancelled=false;
    const interval=window.setInterval(()=>{
      void api(`/automation/runs?project_id=${projectId}`).then(rows=>{if(!cancelled)setRuns(rows);}).catch(e=>{if(!cancelled)setError(String(e));});
    },10000);
    return ()=>{cancelled=true;window.clearInterval(interval);};
  },[api,projectId]);
  const task=async(action:()=>Promise<void>)=>{
    setBusy(true);setError('');setMessage('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const openHistory=async()=>{
    setShowHistory(true);setHistoryLoading(true);setHistoryError('');
    try{await load();}catch(reason){setHistoryError(reason instanceof Error?reason.message:String(reason));}
    finally{setHistoryLoading(false);}
  };
  return <>
    {headerActions&&canLead&&createPortal(<button className="automation-history-button" aria-label="Schedule" aria-haspopup="dialog" onClick={()=>setShowSchedules(true)}><CalendarClock size={16}/><span>Schedule</span></button>,headerActions)}
    {headerActions&&createPortal(<button className="automation-history-button" aria-label="History" title="View the last 10 automation runs" aria-haspopup="dialog" onClick={()=>void openHistory()}><HistoryIcon size={16}/><span>History</span><span className="automation-history-count">{recentRuns.length}</span></button>,headerActions)}
    {canLead&&<AutomationSchedules open={showSchedules} onClose={()=>setShowSchedules(false)} projectId={projectId} cycleId={cycleId} cycles={cycles} api={api}/>}
    <Panel title="Run on Bitbucket runner">
      <p>Run a custom pipeline on your runner PC and view its HTML report and test results here.</p>
      {!ready.credentials_configured&&<p className="warning">Set BITBUCKET_API_TOKEN on the backend. For an Atlassian API token, also set BITBUCKET_EMAIL.</p>}
      {!ready.callback_configured&&<p className="warning">Set QA_PUBLIC_URL to this app’s URL reachable from the runner PC.</p>}
      {canLead&&<><div className="grid">{(['workspace','repository','branch','pipeline'] as const).map(name=><Field key={name} name={name} label={{workspace:'Bitbucket workspace',repository:'Repository slug',branch:'Branch',pipeline:'Custom pipeline name'}[name]} value={config[name]} onChange={value=>setConfig(prev=>({...prev,[name]:value}))}/>)}</div>
      <button disabled={busy} onClick={()=>void task(async()=>{
        await api(`/automation/bitbucket?project_id=${projectId}`,{method:'PUT',body:JSON.stringify(config)});
        setReady(await api(`/automation/bitbucket?project_id=${projectId}`));setMessage('Bitbucket settings saved.');
      })}>Save Bitbucket settings</button>
      <SelectField label="Report cycle" value={selectedCycle} onChange={v=>setSelectedCycle(Number(v))} items={cycles.map(c=>({value:c.id,label:c.name}))}/>
      <button disabled={busy||!selectedCycle||!ready.config||!ready.credentials_configured||!ready.callback_configured} onClick={()=>void task(async()=>{
        const run=await api('/automation/runs',{method:'POST',body:JSON.stringify({cycle_id:selectedCycle})});
        await load();if(run.error)setError(run.error);else setMessage(`Run #${run.id} started. Results will appear after the runner uploads its report.`);
      })}>{busy?'Please wait…':'Run automation'}</button></>}
      {error&&<p role="alert" className="warning">{error}</p>}{message&&<p role="status">{message}</p>}
    </Panel>
    <Panel title="Run reports">
      <p>Last 10 runs for this project, newest first.</p>
          <Table headers={['Run','Started','Cycle','Branch / pipeline','Result','Report',...(canLead?['Actions']:[])]}>
            {recentRuns.map(run=>{const outcome=runOutcome(run);return <tr key={run.id}>
              <td>#{run.id}</td><td>{runTime(run.created_at)}</td><td>{cycles.find(c=>c.id===run.cycle_id)?.name??run.cycle_id}</td><td>{run.branch}<br/>{run.pipeline}</td>
              <td><span className={`automation-run-status ${outcome.tone}`}>{outcome.label}</span></td>
              <td>{run.html_report_url?<button onClick={()=>setViewReport({...run})}>View HTML report</button>:run.report?'Results received':'No report received'}</td>
              {canLead&&<td><button disabled={busy} onClick={()=>void task(async()=>{await api(`/automation/runs/${run.id}/refresh`,{method:'POST'});await load();onReport();})}>Refresh status</button></td>}
            </tr>;})}
          </Table>
      {recentRuns.length===0&&<p>No automation runs yet.</p>}
    </Panel>
    <dialog ref={historyDialog} className="automation-history-dialog automation-history-expanded" aria-labelledby="automation-history-title" onCancel={()=>setShowHistory(false)}>
      <div className="automation-history-header"><h2 id="automation-history-title">Automation history</h2><button className="secondary" onClick={()=>setShowHistory(false)}>Close history</button></div>
      {historyLoading?<p role="status">Loading history…</p>:historyError?<div role="alert"><p>{historyError}</p><button onClick={()=>void openHistory()}>Retry history</button></div>:<>
        {recentRuns.length>0&&<>
          <AutomationHistoryMatrix runs={recentRuns}/>

        </>}
        {recentRuns.length===0&&<p>No automation runs yet.</p>}
      </>}
    </dialog>
    {viewReport&&<div ref={reportPanel} style={{scrollMarginTop:120}}><Panel title={`HTML report — Run #${viewReport.id}`}>
      <button className="secondary" onClick={()=>setViewReport(null)}>Close report</button>
      <HtmlReportViewer key={viewReport.id} runId={viewReport.id} url={viewReport.html_report_url}/>
    </Panel></div>}
  </>;
}
