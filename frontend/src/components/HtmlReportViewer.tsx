import {useEffect, useState} from 'react';

// Embedded documents do not retain the response's CSP header. Keep reports
// isolated and prevent their scripts/assets from accessing the network.
const reportPolicy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;

export default function HtmlReportViewer({runId, url}: {runId:number; url:string}) {
  const [attempt,setAttempt]=useState(0);
  const [report,setReport]=useState<{document:string; downloadUrl:string}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    let active=true;
    let objectUrl='';
    let timedOut=false;
    setReport(null);setError('');
    const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},45000);
    void (async()=>{
      try {
        const response=await fetch(url,{credentials:'include',signal:controller.signal});
        if(!response.ok)throw new Error(`Could not load report (HTTP ${response.status}).${response.status===401||response.status===403?' Sign in again and retry.':''}`);
        if(!response.headers.get('content-type')?.includes('text/html'))throw new Error('The server did not return an HTML report.');
        const content=await response.text();
        if(!content.trim())throw new Error('The HTML report is empty.');
        if(!active)return;
        objectUrl=URL.createObjectURL(new Blob([content],{type:'text/html'}));
        setReport({document:reportPolicy+content,downloadUrl:objectUrl});
      } catch(reason) {
        if(active)setError(timedOut?'Report loading timed out. Check the connection and retry.':reason instanceof Error?reason.message:'Could not load the report.');
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return ()=>{
      active=false;controller.abort();window.clearTimeout(timeout);
      if(objectUrl)URL.revokeObjectURL(objectUrl);
    };
  },[url,attempt]);

  return <>
    {!report&&!error&&<p role="status">Downloading HTML report… Large reports may take a few seconds.</p>}
    {error&&<div role="alert"><p>{error}</p><button onClick={()=>setAttempt(value=>value+1)}>Retry report</button></div>}
    {report&&<>
      <div className="buttons">
        <a href={url} target="_blank" rel="noopener noreferrer">Open report in new tab</a>
        <a href={report.downloadUrl} download={`automation-run-${runId}.html`}>Download HTML report</a>
      </div>
      <iframe title={`Automation HTML report for run ${runId}`} srcDoc={report.document} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{display:'block',width:'100%',height:'75vh',border:'1px solid #ccc',background:'#fff'}}/>
    </>}
  </>;
}
