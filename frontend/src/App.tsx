import ResourceManagement from './pages/ResourceManagement';
import AutomationRunner from './pages/AutomationRunner';
import TestCases from './pages/TestCases';
import Dashboard from './pages/Dashboard';
import {Panel, Table, SelectField, Field} from './components/ui';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Activity, Bell, Bug, Calendar, CheckSquare, FileText, Folder, GitBranch, LayoutDashboard, List, LogOut, Play, ShieldCheck, SlidersHorizontal, Users, type LucideIcon} from 'lucide-react';

type Row = Record<string, any>;
type Page = 'Dashboard'|'Projects'|'Test Cases'|'Plans & Cycles'|'Execution'|'Automation'|'Defects'|'Requirements'|'Custom Fields'|'Reports'|'Audit'|'Notifications'|'Resource Management'|'Admin';
const pages: Page[] = ['Dashboard','Projects','Test Cases','Plans & Cycles','Execution','Automation','Defects','Requirements','Custom Fields','Reports','Audit','Notifications','Resource Management','Admin'];
const pageIcons: Record<Page,LucideIcon> = {
  Dashboard:LayoutDashboard, Projects:Folder, 'Test Cases':CheckSquare, 'Plans & Cycles':Calendar,
  Execution:Play, Automation:GitBranch, Defects:Bug, Requirements:List, 'Custom Fields':SlidersHorizontal,
  Reports:FileText, Audit:ShieldCheck, Notifications:Bell, 'Resource Management':Users, Admin:Users
};
const priorities = ['Low','Medium','High','Critical'];
const globalRoles = [{value:'admin',label:'Admin'},{value:'qa_lead',label:'QA Lead'},{value:'test_lead',label:'Test Lead'},{value:'tester',label:'Tester'},{value:'viewer',label:'Viewer'}];
const projectRoles = ['admin','lead','tester','viewer'];
const statuses = ['Passed','Failed','Blocked','Skipped'];
const savedPage = (): Page => {
  const page = sessionStorage.getItem('qa-current-page');
  return pages.includes(page as Page) ? page as Page : 'Dashboard';
};

function RoleCheckboxes({value,onChange,name}: {value:string[];onChange:(roles:string[])=>void;name:string}) {
  const selected=value.map(role=>role==='lead'?'qa_lead':role);
  return <div className="role-options" aria-label={name}>{globalRoles.map(role=><label key={role.value}><input type="checkbox" checked={selected.includes(role.value)} onChange={event=>onChange(event.target.checked?[...selected,role.value]:selected.filter(item=>item!==role.value))}/>{role.label}</label>)}</div>;
}
export default function App() {
  const [authenticated,setAuthenticated]=useState(false);
  const [registering,setRegistering]=useState(false);
  const [authBusy,setAuthBusy]=useState(false);
  const [authMessage,setAuthMessage]=useState('');
  const [checkingSession,setCheckingSession]=useState(true);
  const [user,setUser]=useState<Row|null>(null);
  const [error,setError]=useState('');
  const [page,setPage]=useState<Page>(savedPage);
  const [projectId,setProjectId]=useState(0);
  const [projects,setProjects]=useState<Row[]>([]);
  const [projectMenuOpen,setProjectMenuOpen]=useState(false);
  const [automationHeaderActions,setAutomationHeaderActions]=useState<HTMLDivElement|null>(null);
  const projectMenuRef=useRef<HTMLDivElement>(null);
  const [users,setUsers]=useState<Row[]>([]);
  const [cases,setCases]=useState<Row[]>([]);
  const [plans,setPlans]=useState<Row[]>([]);
  const [cycles,setCycles]=useState<Row[]>([]);
  const [cycleId,setCycleId]=useState(0);
  const [cycleCases,setCycleCases]=useState<Row[]>([]);
  const [executions,setExecutions]=useState<Row[]>([]);
  const [defects,setDefects]=useState<Row[]>([]);
  const [requirements,setRequirements]=useState<Row[]>([]);
  const [customFields,setCustomFields]=useState<Row[]>([]);
  const [notifications,setNotifications]=useState<Row[]>([]);
  const [dashboardRefresh,setDashboardRefresh]=useState(0);
  const [auditEvents,setAuditEvents]=useState<Row[]>([]);
  const [form,setForm]=useState<Row>({});
  const [editProjectId,setEditProjectId]=useState(0);
  const [selectedCycle,setSelectedCycle]=useState(0);
  const [showArchived,setShowArchived]=useState(false);
  useEffect(()=>{sessionStorage.setItem('qa-current-page',page);},[page]);
  useEffect(()=>{
    if(!projectMenuOpen)return;
    const closeOnOutsideClick=(event:PointerEvent)=>{
      if(!projectMenuRef.current?.contains(event.target as Node))setProjectMenuOpen(false);
    };
    const closeOnEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape')setProjectMenuOpen(false);
    };
    document.addEventListener('pointerdown',closeOnOutsideClick);
    document.addEventListener('keydown',closeOnEscape);
    return ()=>{
      document.removeEventListener('pointerdown',closeOnOutsideClick);
      document.removeEventListener('keydown',closeOnEscape);
    };
  },[projectMenuOpen]);

  const field=(name:string,label:string,type='text',required=false)=> <Field key={name} name={name} label={label} type={type} required={required} value={form[name]??''} onChange={value=>setForm(prev=>({...prev,[name]:value}))}/>;
  const select=(name:string,label:string,options:string[])=> <SelectField key={name} label={label} value={form[name]??''} onChange={value=>setForm(prev=>({...prev,[name]:value}))} items={options.map(x=>({value:x,label:x}))}/>;
  const projectMembers=useMemo(()=>projects.find(p=>p.id===projectId)?.members??[],[projects,projectId]);
  const assignedRoles=(user?.roles??[user?.role]).map((role:string)=>role==='lead'?'qa_lead':role);
  const isAdmin=assignedRoles.includes('admin');
  const isGlobalLead=assignedRoles.some((role:string)=>role==='qa_lead'||role==='test_lead');
  const currentRole=isAdmin?'Admin':assignedRoles.includes('qa_lead')?'QA Lead':assignedRoles.includes('test_lead')?'Test Lead':projects.find(p=>p.id===projectId)?.role??'Viewer';
  const canLead=isAdmin||isGlobalLead||['admin','lead'].includes(projects.find(p=>p.id===projectId)?.role??'');
  const canWrite=isAdmin||isGlobalLead||['admin','lead','tester'].includes(projects.find(p=>p.id===projectId)?.role??'');

  const api=useCallback(async(path:string,options:RequestInit={})=>{
    const response=await fetch('/api'+path,{...options,credentials:'include',headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
    if(!response.ok) {
      const raw=await response.text();
      let message=raw;
      try {
        const detail=JSON.parse(raw).detail;
        message=Array.isArray(detail)?detail.map((item:Row)=>`${item.loc?.join('.')??'Request'}: ${item.msg??'Invalid value'}`).join('; '):detail??raw;
      } catch { /* Keep the server's plain-text error. */ }
      if(response.status===401&&path!=='/auth/login'){setAuthenticated(false);setUser(null);}
      throw new Error(String(message||`Request failed (${response.status})`));
    }
    if(response.status===204)return null;
    if(response.headers.get('content-type')?.includes('text/csv')||response.headers.get('content-type')?.includes('spreadsheetml'))return response.blob();
    return response.json();
  },[]);
  const post=useCallback((path:string,value:Row)=>api(path,{method:'POST',body:JSON.stringify(value)}),[api]);
  const refresh=useCallback(async()=>{
    const [me,projectRows,noticeRows]=await Promise.all([api('/me'),api(`/projects${showArchived?'?include_archived=true':''}`),api('/notifications')]);
    setUser(me);setProjects(projectRows);setNotifications(noticeRows);
    if(!projectRows.some((p:Row)=>p.id===projectId))setProjectId(projectRows[0]?.id??0);
    if((me.roles??[me.role]).includes('admin'))setUsers(await api('/users'));
  },[api,projectId,showArchived]);
  const refreshProject=useCallback(async()=>{
    if(!authenticated||!projectId)return;
    const [caseRows,planRows,cycleRows,defectRows,members,fields,reqs]=await Promise.all([
      api(`/cases?project_id=${projectId}${showArchived?'&include_archived=true':''}`),
      api(`/plans?project_id=${projectId}`),api(`/cycles?project_id=${projectId}`),
      api(`/defects?project_id=${projectId}`),
      api(`/projects/${projectId}/members`),api(`/custom-fields?project_id=${projectId}`),api(`/requirements?project_id=${projectId}`)
    ]);
    setCases(caseRows);setPlans(planRows);setCycles(cycleRows);setDefects(defectRows);setDashboardRefresh(value=>value+1);
    if((user?.roles??[user?.role]).includes('admin'))setUsers(await api('/users'));
    else {
      const directory=canLead?await api(`/projects/${projectId}/available-users`):[];
      setUsers([...members.map((m:Row)=>({id:m.user_id,name:m.name,email:m.email,role:m.role,active:true})),...directory]);
    }
    setProjects(prev=>prev.map(p=>p.id===projectId?{...p,members}:p));setCustomFields(fields);setRequirements(reqs);
    if(!cycleRows.some((c:Row)=>c.id===cycleId))setCycleId(cycleRows[0]?.id??0);
  },[api,authenticated,projectId,cycleId,canLead,showArchived,user]);
  const refreshCycle=useCallback(async()=>{
    if(!authenticated||!cycleId){setCycleCases([]);setExecutions([]);return;}
    const [items,history]=await Promise.all([api(`/cycles/${cycleId}/cases`),api(`/executions?cycle_id=${cycleId}`)]);
    setCycleCases(items);setExecutions(history);
  },[api,authenticated,cycleId]);
  const run=async(task:()=>Promise<unknown>)=>{try{setError('');await task();if(authenticated){await refresh();await refreshProject();await refreshCycle();}}catch(e){setError(e instanceof Error?e.message:String(e));}};

  useEffect(()=>{api('/me').then(async me=>{setUser(me);setAuthenticated(true);}).catch(()=>setAuthenticated(false)).finally(()=>setCheckingSession(false));},[api]);
  useEffect(()=>{if(authenticated)void refresh().catch(e=>setError(String(e)));},[authenticated,refresh]);
  useEffect(()=>{if(authenticated)void refreshProject().catch(e=>setError(String(e)));},[authenticated,refreshProject]);
  useEffect(()=>{if(authenticated)void refreshCycle().catch(e=>setError(String(e)));},[authenticated,refreshCycle]);
  useEffect(()=>{if(authenticated&&page==='Audit')void api(`/audit?project_id=${projectId}`).then(setAuditEvents).catch(e=>setError(String(e)));},[authenticated,page,projectId,api]);

  const download=async(path:string,name:string)=>{
    const blob=await api(path) as Blob;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
  };
  const handleLogin=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(authBusy)return;
    const values=Object.fromEntries(new FormData(event.currentTarget));
    setAuthBusy(true);setError('');setAuthMessage('');
    try {
      if(registering){
        await post('/auth/register',values);
        setRegistering(false);
        setForm({email:values.email,password:''});
        setAuthMessage('Account created. Sign in with your email and password.');
      }else{
        await post('/auth/login',values);
        setForm({});setAuthenticated(true);
      }
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setAuthBusy(false);}
  };
  const handleLogout=async()=>{try{await api('/auth/logout',{method:'POST'});}finally{setAuthenticated(false);setUser(null);setProjectId(0);setCycleId(0);}};
  const memberOptions=projectMembers.map((m:Row)=>({value:m.user_id,label:`${m.name} (${m.role})`}));
  const cycleOptions=cycles.map(c=>({value:c.id,label:`${c.name} · ${c.environment}`}));

  if(checkingSession)return <main className="login"><div className="panel">Loading session…</div></main>;
  if(!authenticated)return <main className="login"><form onSubmit={handleLogin} className="panel">
    <div className="brand-mark"><Activity size={19}/></div><h1>Docpanel QA</h1>
    <p>{registering?'Create your workspace account':'Sign in to your test workspace'}</p>
    {registering&&field('name','Name','text',true)}
    {field('email','Email','email',true)}
    <label>{registering?'Password (12+ characters)':'Password'}<input name="password" type="password" required minLength={registering?12:undefined} maxLength={registering?256:undefined} autoComplete={registering?'new-password':'current-password'} value={form.password??''} onChange={e=>setForm(prev=>({...prev,password:e.target.value}))}/></label>
    <button type="submit" disabled={authBusy}>{authBusy?'Please wait...':registering?'Create Username':'Sign in'}</button>
    <button type="button" className="secondary" disabled={authBusy} onClick={()=>{setRegistering(!registering);setForm({});setError('');setAuthMessage('');}}>{registering?'Back to sign in':'Create Username'}</button>
    {authMessage&&<p role="status">{authMessage}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </form></main>;

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Activity size={19}/></div><div><div className="brand-name">docpanel</div><div className="brand-caption">QA workspace</div></div></div>
      <nav className="nav-list" aria-label="Main navigation">{pages.filter(p=>p!=='Resource Management'||isAdmin||isGlobalLead).map(p=>{const Icon=pageIcons[p];return <button key={p} className={`nav ${page===p?'active':''}`} onClick={()=>{setPage(p);setForm({});}}><Icon size={17}/><span>{p}{p==='Notifications'?` (${notifications.filter(n=>!n.read).length})`:''}</span></button>;})}</nav>
      <div className="sidebar-footer"><div className="user-avatar">{String(user?.name??'U').split(/\s+/).map((part:string)=>part[0]).join('').slice(0,2).toUpperCase()}</div><div className="user-meta"><strong>{user?.name}</strong><small>{currentRole}</small></div><button className="nav sign-out" aria-label="Sign out" title="Sign out" onClick={()=>void handleLogout()}><LogOut size={17}/></button></div>
    </aside>
    <div className="main-shell"><main className={`content ${page==='Test Cases'?'test-cases-page':''}`}><header className="page-header"><div className="page-heading"><span className="eyebrow">Docpanel QA / Workspace</span><h1>{page}</h1></div><div className="page-header-actions">{page==='Automation'&&<div className="automation-header-actions" ref={setAutomationHeaderActions}/>}{page!=='Resource Management'&&<div className="project-switcher" ref={projectMenuRef}><button type="button" className="header-project" aria-haspopup="listbox" aria-expanded={projectMenuOpen} onClick={()=>setProjectMenuOpen(open=>!open)}><Folder size={16}/><span>{projects.find(p=>p.id===projectId)?.name??'No project selected'}</span></button>{projectMenuOpen&&<div className="project-menu" role="listbox" aria-label="Projects">{projects.map(p=><button type="button" role="option" aria-selected={projectId===p.id} key={p.id} className={`project-menu-option ${projectId===p.id?'active':''}`} title={p.name} onClick={()=>{setProjectId(p.id);setProjectMenuOpen(false);}}>{p.name}</button>)}{!projects.length&&<p className="no-projects">No projects available</p>}</div>}</div>}</div></header>
      {error&&<div className="error" role="alert" onClick={()=>setError('')}>{error} ×</div>}
      {!projectId&&page!=='Dashboard'&&page!=='Test Cases'&&page!=='Projects'&&page!=='Admin'&&page!=='Notifications'&&page!=='Resource Management'&&<Panel title="No project selected">Create a project or ask an administrator to grant you access.</Panel>}

      {page==='Dashboard'&&<Dashboard key={projectId} projectId={projectId} cycles={cycles} plans={plans} api={api} refreshVersion={dashboardRefresh}/> }

      {page==='Projects'&&<><Panel title="Projects"><label><input type="checkbox" checked={showArchived} onChange={e=>{setShowArchived(e.target.checked);void api(`/projects${e.target.checked?'?include_archived=true':''}`).then(setProjects).catch(x=>setError(String(x)));}}/> Show archived projects</label><Table headers={['Key','Name','Description','Role','Actions']}>{projects.map(p=><tr key={p.id}><td>{p.key}</td><td>{p.name}</td><td>{p.description}</td><td>{p.role}</td><td><button onClick={()=>{setProjectId(p.id);setEditProjectId(p.id);setForm({key:p.key,name:p.name,description:p.description});}}>Edit</button>{p.archived?<button onClick={()=>void run(()=>api(`/projects/${p.id}/restore`,{method:'POST'}))}>Restore</button>:<button className="danger" onClick={()=>void run(()=>api(`/projects/${p.id}/archive`,{method:'POST'}))}>Archive</button>}</td></tr>)}</Table></Panel>
      {canLead&&<Panel title={editProjectId?'Edit project':'Create project'}>{field('key','Project key')}{field('name','Project name')}{field('description','Description')}<button onClick={()=>void run(async()=>{if(editProjectId)await api(`/projects/${editProjectId}`,{method:'PATCH',body:JSON.stringify({key:form.key,name:form.name,description:form.description})});else await post('/projects',{key:form.key,name:form.name,description:form.description??''});setEditProjectId(0);setForm({});})}>Save project</button></Panel>}
      {canLead&&projectId>0&&<Panel title="Project membership"><div className="grid">{field('memberEmail','Find user by email')}{select('memberRole','Project role',projectRoles)}<button onClick={()=>void run(async()=>{const target=users.find(x=>x.email.toLowerCase()===String(form.memberEmail??'').toLowerCase());if(!target)throw new Error('No user with that email');await post(`/projects/${projectId}/members`,{user_id:target.id,role:form.memberRole||'tester'});})}>Grant or update access</button></div><Table headers={['Name','Email','Project role']}>{projectMembers.map((m:Row)=><tr key={m.user_id}><td>{m.name}</td><td>{m.email}</td><td>{m.role}</td></tr>)}</Table></Panel>}</>}

      {page==='Test Cases'&&<TestCases key={projectId} projectId={projectId} canWrite={canWrite} api={api} onChanged={refreshProject}/> }

      {page==='Plans & Cycles'&&projectId>0&&<><Panel title="Create test plan">{field('planName','Name','text',true)}{field('release','Release')}{field('scope','Scope')}{field('caseIds','Selected case IDs (comma separated)')}<button onClick={()=>void run(()=>post('/plans',{project_id:projectId,name:form.planName,release:form.release??'',scope:form.scope??'',case_ids:String(form.caseIds??'').split(',').map((x:string)=>Number(x.trim())).filter(Boolean)}))}>Create plan with cases</button></Panel><Panel title="Plans"><Table headers={['Name','Release','Scope','Owner','Cases']}>{plans.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.release}</td><td>{p.scope}</td><td>{p.owner_id??'—'}</td><td><button onClick={()=>void api(`/plans/${p.id}/cases`).then(rows=>setForm(f=>({...f,planCases:rows}))).catch(e=>setError(String(e)))}>View</button></td></tr>)}</Table>{form.planCases&&<pre>{JSON.stringify(form.planCases,null,2)}</pre>}</Panel>      <Panel title="Create cycle"><SelectField label="Plan" value={form.plan_id??''} onChange={v=>setForm(f=>({...f,plan_id:Number(v)}))} items={plans.map(p=>({value:p.id,label:p.name}))}/>{field('cycleName','Cycle name','text',true)}{field('environment','Environment')}<div className="grid">{field('start_date','Start date','date')}{field('end_date','End date','date')}</div><button onClick={()=>void run(()=>post('/cycles',{plan_id:Number(form.plan_id),name:form.cycleName,environment:form.environment||'QA',start_date:form.start_date||null,end_date:form.end_date||null}))}>Create cycle</button></Panel><Panel title="Cycles"><Table headers={['Name','Environment','Starts','Ends']}>{cycles.map(c=><tr key={c.id}><td>{c.name}</td><td>{c.environment}</td><td>{String(c.start_date??'')}</td><td>{String(c.end_date??'')}</td></tr>)}</Table></Panel></>}

      {page==='Execution'&&projectId>0&&<><Panel title="Cycle setup"><SelectField label="Cycle" value={cycleId} onChange={v=>setCycleId(Number(v))} items={cycleOptions}/>{canLead&&cycleId>0&&<div className="grid"><SelectField label="Add case" value={form.case_id??''} onChange={v=>setForm(f=>({...f,case_id:Number(v)}))} items={cases.map(c=>({value:c.id,label:`TC-${c.id}: ${c.title}`}))}/><SelectField label="Version (optional)" value={form.version_id??''} onChange={v=>setForm(f=>({...f,version_id:v}))} items={[]}/><SelectField label="Assign tester" value={form.assigned_to??''} onChange={v=>setForm(f=>({...f,assigned_to:v?Number(v):null}))} items={memberOptions}/><button onClick={()=>void run(()=>post(`/cycles/${cycleId}/cases`,{case_id:Number(form.case_id),assigned_to:form.assigned_to||null}))}>Add to cycle</button></div>}</Panel><Panel title="Manual execution">{cycleCases.map(cc=><ExecutionItem key={cc.id} item={cc} canWrite={canWrite} api={api} refresh={refreshCycle} setError={setError}/>)}</Panel><Panel title="Execution attempt history"><Table headers={['Attempt','Case','Status','Executor','Actual result / comments','Source','Time']}>{executions.map(e=><tr key={e.id}><td>{e.id}</td><td>{e.cycle_case_id}</td><td>{e.status}</td><td>{e.user_id}</td><td>{e.actual_result||e.notes}</td><td>{e.source}</td><td>{String(e.created_at??'')}</td></tr>)}</Table></Panel></>}

      {page==='Automation'&&projectId>0&&<><AutomationRunner key={projectId} headerActions={automationHeaderActions} projectId={projectId} cycleId={cycleId} cycles={cycles} canLead={canLead} api={api} onReport={()=>{void refreshCycle().catch(e=>setError(String(e)));setDashboardRefresh(v=>v+1);}}/></>}

      {page==='Defects'&&projectId>0&&<><Panel title="Defect tracking"><div className="grid">{field('defectSearch','Search title')}<SelectField label="Filter status" value={form.defectStatus??''} onChange={v=>setForm(f=>({...f,defectStatus:v}))} items={['New','Open','In Progress','Fixed','Retest','Closed','Reopened'].map(x=>({value:x,label:x}))}/><button onClick={()=>void api(`/defects?project_id=${projectId}&q=${encodeURIComponent(form.defectSearch??'')}${form.defectStatus?`&status=${encodeURIComponent(form.defectStatus)}`:''}`).then(setDefects).catch(e=>setError(String(e)))}>Filter</button></div><Table headers={['Key','Title','Severity','Priority','Status','Assignee','Actions']}>{defects.map(d=><tr key={d.id}><td>BUG-{d.id}</td><td>{d.title}</td><td>{d.severity}</td><td>{d.priority}</td><td><select value={d.status} onChange={e=>void run(()=>api(`/defects/${d.id}?status=${encodeURIComponent(e.target.value)}`,{method:'PATCH'}))}>{['New','Open','In Progress','Fixed','Retest','Closed','Reopened'].map(x=><option key={x}>{x}</option>)}</select></td><td>{d.assigned_to??'—'}</td><td><button onClick={()=>void api(`/defects/${d.id}`).then(x=>setForm(f=>({...f,defectDetails:x}))).catch(e=>setError(String(e)))}>Details</button></td></tr>)}</Table>{form.defectDetails&&<pre>{JSON.stringify(form.defectDetails,null,2)}</pre>}</Panel><Panel title="Create defect">{field('defectTitle','Title','text',true)}{field('defectDescription','Description')}{select('severity','Severity',priorities)}{select('defectPriority','Priority',priorities)}<SelectField label="Link execution attempt" value={form.execution_id??''} onChange={v=>setForm(f=>({...f,execution_id:v?Number(v):null}))} items={executions.map(e=>({value:e.id,label:`#${e.id} ${e.status}`}))}/><SelectField label="Assign to project member" value={form.assigned_to??''} onChange={v=>setForm(f=>({...f,assigned_to:v?Number(v):null}))} items={memberOptions}/><button onClick={()=>void run(()=>post('/defects',{project_id:projectId,title:form.defectTitle,description:form.defectDescription??'',severity:form.severity||'Medium',priority:form.defectPriority||'Medium',assigned_to:form.assigned_to||null,execution_ids:form.execution_id?[Number(form.execution_id)]:[]}))}>Create defect</button></Panel></>}

      {page==='Requirements'&&projectId>0&&<><Panel title="Requirement traceability">{requirements.map(r=><div className="run" key={r.id}><b>{r.key}: {r.title}</b><p>{r.description}</p><small>{r.case_ids?.length??0} linked test cases</small><div className="grid"><SelectField label="Link case" value={form.requirementCase??''} onChange={v=>setForm(f=>({...f,requirementCase:Number(v)}))} items={cases.map(c=>({value:c.id,label:`TC-${c.id}: ${c.title}`}))}/><button onClick={()=>void run(()=>api(`/requirements/${r.id}/cases?case_id=${form.requirementCase}`,{method:'POST'}))}>Link</button><button className="secondary" onClick={()=>void api(`/requirements/coverage?project_id=${projectId}`).then(x=>setForm(f=>({...f,coverage:x}))).catch(e=>setError(String(e)))}>Coverage</button></div></div>)}{form.coverage&&<pre>{JSON.stringify(form.coverage,null,2)}</pre>}</Panel><Panel title="Add requirement">{field('reqKey','Requirement key','text',true)}{field('reqTitle','Title','text',true)}{field('reqDescription','Description')}<button onClick={()=>void run(()=>post('/requirements',{project_id:projectId,key:form.reqKey,title:form.reqTitle,description:form.reqDescription??''}))}>Create requirement</button></Panel></>}

      {page==='Custom Fields'&&projectId>0&&<><Panel title="Custom field definitions"><Table headers={['Name','Type','Required','Options']}>{customFields.map(c=><tr key={c.id}><td>{c.name}</td><td>{c.field_type}</td><td>{String(c.required)}</td><td>{JSON.stringify(c.options)}</td></tr>)}</Table></Panel>{canLead&&<Panel title="Add custom field">{field('customName','Name','text',true)}{select('customType','Type',['text','number','date','boolean','select'])}{field('customOptions','Options (comma separated)')}<label><input type="checkbox" checked={!!form.customRequired} onChange={e=>setForm(f=>({...f,customRequired:e.target.checked}))}/> Required</label><button onClick={()=>void run(()=>api(`/custom-fields?project_id=${projectId}&name=${encodeURIComponent(form.customName)}&field_type=${form.customType}&required=${!!form.customRequired}${form.customType==='select'?`&options=${encodeURIComponent(JSON.stringify(String(form.customOptions??'').split(',').map((v:string)=>v.trim()).filter(Boolean)))}`:''}`,{method:'POST'}))}>Add field</button></Panel>}<p>Set values when creating or editing test cases in the repository.</p></>}

      {page==='Reports'&&projectId>0&&<Panel title="CSV reports"><p>Export project-level execution and defect summaries for authorized reporting.</p><SelectField label="Optional cycle filter" value={selectedCycle} onChange={v=>setSelectedCycle(Number(v))} items={[{value:0,label:'All cycles'},...cycleOptions]}/><div className="buttons"><button onClick={()=>void download(`/reports/executions.csv?project_id=${projectId}${selectedCycle?`&cycle_id=${selectedCycle}`:''}`,'executions.csv')}>Export execution report</button><button onClick={()=>void download(`/reports/defects.csv?project_id=${projectId}`,'defects.csv')}>Export defect report</button></div></Panel>}
      {page==='Audit'&&<Panel title="Privileged-change history"><Table headers={['Time','Actor','Action','Entity','Entity ID','Before','After']}>{auditEvents.map(a=><tr key={a.id}><td>{String(a.created_at??'')}</td><td>{a.actor_id}</td><td>{a.action}</td><td>{a.entity_type}</td><td>{a.entity_id}</td><td><pre>{JSON.stringify(a.before)}</pre></td><td><pre>{JSON.stringify(a.after)}</pre></td></tr>)}</Table></Panel>}
      {page==='Notifications'&&<Panel title="Notifications">{notifications.map(n=><div className="item" key={n.id}><b>{n.title}</b><span>{n.message}</span>{!n.read&&<button onClick={()=>void run(()=>api(`/notifications/${n.id}/read`,{method:'POST'}))}>Mark read</button>}</div>)}</Panel>}
      {page==='Resource Management'&&((isAdmin||isGlobalLead)?<ResourceManagement api={api}/>:<Panel title="Resource Management">Only administrators and QA / Test Leads can access the team tracker.</Panel>)}
      {page==='Admin'&&<>{isAdmin?<><Panel title="User administration"><Table headers={['Name','Email','Global roles','Active','Update']}>{users.map(u=><tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td><RoleCheckboxes name={`Roles for ${u.email}`} value={u.roles??[u.role]} onChange={roles=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,roles}:x))}/></td><td><input type="checkbox" checked={u.active} onChange={e=>setUsers(prev=>prev.map(x=>x.id===u.id?{...x,active:e.target.checked}:x))}/></td><td><button onClick={()=>void run(()=>api(`/users/${u.id}`,{method:'PATCH',body:JSON.stringify({roles:users.find(x=>x.id===u.id)?.roles??[u.role],active:users.find(x=>x.id===u.id)?.active})}))}>Save</button></td></tr>)}</Table></Panel><Panel title="Create user">{field('newName','Name','text',true)}{field('newEmail','Email','email',true)}{field('newPassword','Temporary password (12+ characters)','password',true)}<RoleCheckboxes name="New account roles" value={form.newRoles??['tester']} onChange={newRoles=>setForm(prev=>({...prev,newRoles}))}/><button onClick={()=>void run(()=>post('/users',{name:form.newName,email:form.newEmail,password:form.newPassword,roles:form.newRoles??['tester']}))}>Create Username</button></Panel></>:<Panel title="Administration">Only an administrator can manage accounts.</Panel>}</>}
    </main></div>
  </div>;
}

function ExecutionItem({item,canWrite,api,refresh,setError}: {item:Row;canWrite:boolean;api:(path:string,options?:RequestInit)=>Promise<any>;refresh:()=>Promise<void>;setError:(message:string)=>void}) {
  const [actual,setActual]=useState('');
  const [comments,setComments]=useState('');
  const [attachments,setAttachments]=useState<Row[]>([]);
  const [steps,setSteps]=useState<Row[]>(()=>((item.steps??[]) as Row[]).map((s:Row,index:number)=>({index,status:'Not Run',action:s.action??'',expected:s.expected??'',actual:''})));
  useEffect(()=>{if(item.latest_execution_id)void api(`/executions/${item.latest_execution_id}/attachments`).then(setAttachments).catch(e=>setError(String(e)));else setAttachments([]);},[api,item.latest_execution_id,setError]);
  const submit=async(status:string)=>{
    try {
      const result=await api(`/cycle-cases/${item.id}/executions`,{method:'POST',body:JSON.stringify({status,actual_result:actual,notes:comments,step_results:steps.map(x=>({step:x.index,status:x.status,actual:x.actual}))})});
      const file=(document.getElementById(`evidence-${item.id}`) as HTMLInputElement|null)?.files?.[0];
      if(file)await api(`/executions/${result.id}/attachments`,{method:'POST',body:(()=>{const form=new FormData();form.append('file',file);return form;})()});
      setActual('');setComments('');await refresh();
    } catch(e) { setError(e instanceof Error?e.message:String(e)); }
  };
  return <article className="run"><b>TC-{item.case_id}: {item.title}</b><small>Version {item.version} · Assigned to {item.assigned_to??'unassigned'} · Last result: {item.last_status??'Not Run'}</small><p>{item.preconditions}</p>
    {steps.map((step,index)=><div className="step" key={index}><b>Step {index+1}: {step.action}</b><small>Expected: {step.expected}</small><div className="grid"><select value={step.status} onChange={e=>setSteps(prev=>prev.map((s,i)=>i===index?{...s,status:e.target.value}:s))}>{['Passed','Failed','Blocked','Skipped','Not Run'].map(s=><option key={s}>{s}</option>)}</select><input placeholder="Actual step result" value={step.actual} onChange={e=>setSteps(prev=>prev.map((s,i)=>i===index?{...s,actual:e.target.value}:s))}/></div></div>)}
    <label>Actual result<textarea value={actual} onChange={e=>setActual(e.target.value)}/></label><label>Comments<textarea value={comments} onChange={e=>setComments(e.target.value)}/></label><label>Evidence (PNG, JPEG, WEBP, TXT or LOG; up to 10 MB)<input id={`evidence-${item.id}`} type="file" accept=".png,.jpg,.jpeg,.webp,.txt,.log"/></label>
    {attachments.length>0&&<ul>{attachments.map(a=><li key={a.id}><a href={`/api/attachments/${a.id}`}>{a.filename}</a> ({a.size} bytes)</li>)}</ul>}
    {canWrite&&<div className="buttons">{statuses.map(s=><button key={s} onClick={()=>void submit(s)}>{s}</button>)}</div>}
  </article>;
}
