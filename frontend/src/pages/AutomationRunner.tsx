import {useEffect, useState, useCallback, useRef} from 'react';
import {createPortal} from 'react-dom';
import {History as HistoryIcon, CalendarClock, Monitor} from 'lucide-react';
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
  const [localRunner,setLocalRunner]=useState<{configured:boolean;online:boolean;scripts:string[]}>({configured:false,online:false,scripts:[]});
  const [runs,setRuns]=useState<(Row & HistoryRun)[]>([]);
  const [selectedCycle,setSelectedCycle]=useState(cycleId);
  const [selectedScript,setSelectedScript]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [viewReport,setViewReport]=useState<Row|null>(null);
  const [showHistory,setShowHistory]=useState(false);
  const [showSchedules,setShowSchedules]=useState(false);
  const [showLocal,setShowLocal]=useState(false);
  const localDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if(showLocal&&!localDialog.current?.open)localDialog.current?.showModal();
    if(!showLocal&&localDialog.current?.open)localDialog.current.close();
  },[showLocal]);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState('');
  const historyDialog=useRef<HTMLDialogElement>(null);
  const recentRuns=runs.slice(0,10);
  const localRunActive=runs.some(run=>run.source==='local'&&['PENDING','IN_PROGRESS'].includes(run.state));
  useEffect(()=>{
    const dialog=historyDialog.current;
    if(showHistory&&!dialog?.open)dialog?.showModal();
    if(!showHistory&&dialog?.open)dialog.close();
  },[showHistory]);
  const reportPanel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(viewReport)reportPanel.current?.scrollIntoView({behavior:'instant',block:'start'});
  },[viewReport]);
  const seenReports=useRef(new Set<number>());
  const load=useCallback(async()=>{
    const rows=await api(`/automation/runs?project_id=${projectId}`);
    const newReport=rows.some((run:Row)=>{
      if(!run.import_id||seenReports.current.has(run.id))return false;
      seenReports.current.add(run.id);
      return true;
    });
    setRuns(rows);
    if(newReport)onReport();
  },[api,onReport,projectId]);
  useEffect(()=>{let cancelled=false;
    void api(`/automation/bitbucket?project_id=${projectId}`).then(result=>{
      if(cancelled)return;
      setReady(result);if(result.config)setConfig(result.config);
    }).catch(e=>{if(!cancelled)setError(String(e));});
    void load().catch(e=>{if(!cancelled)setError(String(e));});
    return ()=>{cancelled=true;};
  },[api,projectId,load]);
  useEffect(()=>{let cancelled=false;
    const refresh=()=>void api(`/automation/local/status?project_id=${projectId}`)
      .then(result=>{if(!cancelled){
        setLocalRunner(result);
        setSelectedScript(current=>result.scripts.includes(current)?current:'');
      }})
      .catch(e=>{if(!cancelled)setError(String(e));});
    refresh();
    const interval=window.setInterval(refresh,10000);
    return ()=>{cancelled=true;window.clearInterval(interval);};
  },[api,projectId]);
  useEffect(()=>setSelectedCycle(cycleId),[cycleId]);
  useEffect(()=>{let cancelled=false;
    const interval=window.setInterval(()=>{
      void load().catch(e=>{if(!cancelled)setError(String(e));});
    },10000);
    return ()=>{cancelled=true;window.clearInterval(interval);};
  },[load]);
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
    {headerActions&&canLead&&createPortal(<button className="automation-history-button" aria-label="Local" aria-haspopup="dialog" onClick={()=>{setError('');setMessage('');setShowLocal(true);}}><Monitor size={16}/><span>Local</span></button>,headerActions)}
    {headerActions&&createPortal(<button className="automation-history-button" aria-label="History" title="View the last 10 automation runs" aria-haspopup="dialog" onClick={()=>void openHistory()}><HistoryIcon size={16}/><span>History</span><span className="automation-history-count">{recentRuns.length}</span></button>,headerActions)}
    {canLead&&<AutomationSchedules open={showSchedules} onClose={()=>setShowSchedules(false)} projectId={projectId} cycleId={cycleId} cycles={cycles} api={api}/>}
    <Panel title="Run automation">
      <p>Run a Bitbucket pipeline and receive JUnit results and an HTML report for the selected cycle. Use Local above to run a script directly on the runner PC.</p>
      <SelectField label="Report cycle" value={selectedCycle} onChange={v=>setSelectedCycle(Number(v))} items={cycles.map(c=>({value:c.id,label:c.name}))}/>
      {canLead&&<div className="automation-run-options">
      <button disabled={busy||!selectedCycle||!ready.config||!ready.credentials_configured||!ready.callback_configured} onClick={()=>void task(async()=>{
        const run=await api('/automation/runs',{method:'POST',body:JSON.stringify({cycle_id:selectedCycle})});
        await load();if(run.error)setError(run.error);else setMessage(`Run #${run.id} started. Results will appear after the runner uploads its report.`);
      })}>Run on Bitbucket</button>
      </div>}
      {canLead&&<details className="automation-bitbucket-settings">
        <summary>Bitbucket settings</summary>
        {!ready.credentials_configured&&<p className="warning">Bitbucket needs BITBUCKET_API_TOKEN on the backend. For an Atlassian API token, also set BITBUCKET_EMAIL. This does not affect Local Run.</p>}
        {!ready.callback_configured&&<p className="warning">Set QA_PUBLIC_URL to this app’s URL reachable from the Bitbucket runner. This does not affect Local Run.</p>}
        <div className="grid">{(['workspace','repository','branch','pipeline'] as const).map(name=><Field key={name} name={name} label={{workspace:'Bitbucket workspace',repository:'Repository slug',branch:'Branch',pipeline:'Custom pipeline name'}[name]} value={config[name]} onChange={value=>setConfig(prev=>({...prev,[name]:value}))}/>)}</div>
        <button disabled={busy} onClick={()=>void task(async()=>{
          await api(`/automation/bitbucket?project_id=${projectId}`,{method:'PUT',body:JSON.stringify(config)});
          setReady(await api(`/automation/bitbucket?project_id=${projectId}`));setMessage('Bitbucket settings saved.');
        })}>Save Bitbucket settings</button>
      </details>}
      {!showLocal&&error&&<p role="alert" className="warning">{error}</p>}{!showLocal&&message&&<p role="status">{message}</p>}
    </Panel>
    {canLead&&<dialog ref={localDialog} className="automation-history-dialog automation-local-dialog" aria-labelledby="automation-local-title" onCancel={event=>{if(busy)event.preventDefault();else setShowLocal(false);}}>
      <div className="automation-history-header"><h2 id="automation-local-title">Run local automation</h2><button className="secondary" disabled={busy} onClick={()=>setShowLocal(false)}>Close</button></div>
      <p>Run a .sh script directly on the runner PC. Put the project path, environment setup and test command in that script.</p>
      <SelectField label="Report cycle" value={selectedCycle} onChange={v=>setSelectedCycle(Number(v))} items={cycles.map(c=>({value:c.id,label:c.name}))}/>
      {!localRunner.configured?<p className="warning">Local runner is not configured on the 88 PC.</p>:
        <p role="status">{localRunner.online?'Local runner on 88 PC is online.':'Local runner on 88 PC is offline.'}</p>}
      {localRunner.online&&<SelectField label="Local .sh script" value={selectedScript} onChange={setSelectedScript} items={localRunner.scripts.map(script=>({value:script,label:script}))}/>}
      {localRunner.online&&localRunner.scripts.length===0&&<p role="status">No .sh scripts found in the 88 PC local-run scripts folder.</p>}
      {localRunActive&&<p role="status">A local automation run is queued or running. Wait for it to finish before starting another.</p>}
      <p className="resource-hint">Scripts appear here from the runner’s configured scripts folder. Forward "$@" to pytest, or write reports to QA_JUNIT_XML and QA_HTML_REPORT. Results appear in the same run history as Bitbucket.</p>
      {error&&<p role="alert" className="warning">{error}</p>}{message&&<p role="status">{message}</p>}
      <button disabled={busy||!selectedCycle||!selectedScript||!localRunner.online||localRunActive} onClick={()=>void task(async()=>{
        const run=await api('/automation/runs/local',{method:'POST',body:JSON.stringify({cycle_id:selectedCycle,script:selectedScript})});
        await load();setMessage(`Local run #${run.id} (${selectedScript}) queued on the 88 PC.`);
      })}>Run locally</button>
    </dialog>}
    <Panel title="Run reports">
      <p>Last 10 runs for this project, newest first.</p>
          <Table headers={['Run','Started','Cycle','Source / script','Result','Report',...(canLead?['Actions']:[])]}>
            {recentRuns.map(run=>{const outcome=runOutcome(run);return <tr key={run.id}>
              <td>#{run.id}</td><td>{runTime(run.created_at)}</td><td>{cycles.find(c=>c.id===run.cycle_id)?.name??run.cycle_id}</td>                            <td>{run.source==='local'?<>Local (88 PC)<br/>{run.local_script}</>:<>{run.branch}<br/>{run.pipeline}</>}</td>
              <td><span className={`automation-run-status ${outcome.tone}`}>{outcome.label}</span></td>
              <td>{run.html_report_url?<button onClick={()=>setViewReport({...run})}>View HTML report</button>:run.report?'Results received':'No report received'}</td>
              {canLead&&<td>{run.source!=='local'&&<button disabled={busy} onClick={()=>void task(async()=>{await api(`/automation/runs/${run.id}/refresh`,{method:'POST'});await load();})}>Refresh status</button>}</td>}
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
