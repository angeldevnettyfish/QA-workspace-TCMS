type TestResult = {external_id:string; name:string; classname:string; case_id:number|null; status:string; duration:string; message:string};
export type HistoryRun = {id:number; build_number?:number; created_at:string; test_results?:TestResult[]|null};
export default function AutomationHistoryMatrix({runs}:{runs:HistoryRun[]}) {
  // Keep repeated JUnit names distinct while matching the same occurrence across runs.
  const indexed=runs.map(run=>{
    const counts=new Map<string,number>();
    const tests=new Map<string,TestResult>();
    for(const test of run.test_results??[]) {
      const occurrence=counts.get(test.external_id)??0;
      counts.set(test.external_id,occurrence+1);
      tests.set(JSON.stringify([test.external_id,occurrence]),test);
    }
    return {run,tests};
  });
  const rows=new Map<string,TestResult>();
  indexed.forEach(({tests})=>tests.forEach((test,key)=>{if(!rows.has(key))rows.set(key,test);}));
  return <section className="automation-test-history" aria-labelledby="test-history-title">
    <h3 id="test-history-title">Test case results by run</h3>
    <p>Each column is a run, newest first. Expand a result for test details. Durations are in seconds.</p>
    <div className="automation-history-legend"><span className="automation-run-status passed">Passed</span><span className="automation-run-status failed">Failed</span><span className="automation-run-status neutral">Skipped</span><span>Not in report = test absent from this run · No report = test details unavailable</span></div>
    {rows.size>0?<div className="table-wrap automation-matrix-wrap"><table className="automation-matrix"><thead><tr><th scope="col">Test case / method</th>{runs.map(run=><th scope="col" key={run.id}>Run #{run.id}{run.build_number&&<small>Build #{run.build_number}</small>}</th>)}</tr></thead>
      <tbody>{Array.from(rows,([key,test],index)=><tr key={key}><th scope="row"><strong>{test.case_id?`TC-${test.case_id}`:`TC${index+1}`}</strong><span>{test.name||test.external_id||'Unnamed test'}</span><small>{test.classname}</small>{!test.case_id&&<small>Not linked to a TCMS case</small>}</th>{indexed.map(({run,tests})=>{
        const result=tests.get(key);
        return <td key={run.id}>{result?<details className={`automation-test-result ${result.status.toLowerCase()}`}><summary><span>{result.status}</span><small>{result.duration?`${result.duration}s`:'—'}</small></summary><div className="automation-test-detail"><strong>{result.external_id||'Unnamed test'}</strong><p>{result.case_id?`TC-${result.case_id}`:'Not linked to a TCMS case'}</p>{result.message&&<pre>{result.message}</pre>}</div></details>:<span className="automation-result-missing" title={run.test_results==null?'Test details unavailable for this run':'Test not present in this report'}>{run.test_results==null?'No report':'Not in report'}</span>}</td>;
      })}</tr>)}</tbody></table></div>:<p>No test case details available yet. Results will appear after a new JUnit report is uploaded.</p>}
    {runs.some(run=>run.test_results==null)&&<p className="automation-history-note">Some runs have no saved test details. Their HTML reports are available in Run reports on the Automation page when uploaded.</p>}
  </section>;
}
