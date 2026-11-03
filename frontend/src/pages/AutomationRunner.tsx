import {useEffect, useState, useCallback, useRef} from 'react';
import {Panel, Table, Field, SelectField} from '../components/ui';
import HtmlReportViewer from '../components/HtmlReportViewer';

type Row = Record<string, any>;
type Api = (path:string, options?:RequestInit)=>Promise<any>;
export default function AutomationRunner({projectId, cycleId, cycles, canLead, api, onReport}: {
  projectId:number; cycleId:number; cycles:Row[]; canLead:boolean; api:Api; onReport:()=>void;
}) {
  const [config,setConfig]=useState({workspace:'',repository:'',branch:'main',pipeline:'qa-automation'});
  const [ready,setReady]=useState<Row>({});
  const [runs,setRuns]=useState<Row[]>([]);
  const [selectedCycle,setSelectedCycle]=useState(cycleId);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [viewReport,setViewReport]=useState<Row|null>(null);
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
  return <>
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
    <Panel title="Automation runs">
      <p>Report uploads appear automatically every 10 seconds. Refresh a run to check its Bitbucket pipeline status.</p>
      <Table headers={['Run','Cycle','Branch / pipeline','Pipeline status','Report','Actions']}>
        {runs.map(run=><tr key={run.id}><td>#{run.id}<br/><small>{run.created_at}</small></td><td>{cycles.find(c=>c.id===run.cycle_id)?.name??run.cycle_id}</td><td>{run.branch}<br/>{run.pipeline}</td><td>{run.state}{run.result?` / ${run.result}`:''}{run.error&&<p>{run.error}</p>}</td>
          <td>{run.html_report_url&&<button onClick={()=>setViewReport({...run})}>View HTML report</button>}{run.report?<>{run.report.imported} imported<br/>{run.report.unmatched.length} unmatched{run.report.unmatched.length>0&&<details><summary>Unmatched tests</summary><pre>{JSON.stringify(run.report.unmatched,null,2)}</pre></details>}{run.report.errors.length>0&&<pre>{JSON.stringify(run.report.errors,null,2)}</pre>}</>:run.state==='COMPLETED'?'No report received':'Waiting for report'}</td>
          <td>{run.url&&<a href={run.url} target="_blank" rel="noreferrer">Open Bitbucket</a>}{canLead&&<button disabled={busy} onClick={()=>void task(async()=>{await api(`/automation/runs/${run.id}/refresh`,{method:'POST'});await load();onReport();})}>Refresh status</button>}</td>
        </tr>)}
      </Table>{runs.length===0&&<p>No automation runs yet.</p>}
    </Panel>
    {viewReport&&<div ref={reportPanel} style={{scrollMarginTop:120}}><Panel title={`HTML report — Run #${viewReport.id}`}>
      <button className="secondary" onClick={()=>setViewReport(null)}>Close report</button>
      <HtmlReportViewer key={viewReport.id} runId={viewReport.id} url={viewReport.html_report_url}/>
    </Panel></div>}
  </>;
}
