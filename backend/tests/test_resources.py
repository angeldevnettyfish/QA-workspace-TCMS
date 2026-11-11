import csv
import io
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
from test_srs_workflows import client
from app import main, resources
from app.models import ResourceEmailSettings
from app.resources import HEADERS, parse_tracker


def tracker(rows, title='Sprint_10B'):
    buf=io.StringIO()
    writer=csv.writer(buf)
    writer.writerow([title]+['']*16)
    writer.writerow(['']*17)
    writer.writerow(HEADERS)
    writer.writerows(rows)
    return buf.getvalue().encode('utf-8-sig')


@pytest.fixture
def source():
    return tracker([
        ['ITEM-49','21 Oct 2026','Regression\nSanity','RT','Solai','High','4','8','200%','','Completed','No','Yes','2','0','3','Multiline\ncomment'],
        ['ITEM-49','22 Oct 2026','Follow-up','','Preethi','Medium','','','','','In Progress','','','','','',''],
        ['']*17,
        ['']*16+['1'],
    ])


def import_csv(client, source, suffix=''):
    return client.post('/api/resources/import'+suffix, files={'file':('tracker.csv',source,'text/csv')})


def test_import_preserves_sheet_and_export_roundtrip(client, source):
    response=import_csv(client,source)
    assert response.status_code==200, response.text
    result=response.json()
    assert result['imported']==2
    sprint_id=result['sprint_id']
    items=client.get(f'/api/resources/sprints/{sprint_id}/items').json()
    assert [row['item_id'] for row in items]==['ITEM-49','ITEM-49']
    assert items[0]['completion_percent']==200
    assert items[0]['task']=='Regression\nSanity'
    assert items[0]['start_date']=='2026-10-21'
    assert items[0]['comment']=='Multiline\ncomment'
    assert items[1]['actual_hours'] is None
    assert items[1]['completion_percent'] is None
    assert items[1]['test_cases'] is None
    assert import_csv(client,source).status_code==409
    assert len(client.get(f'/api/resources/sprints/{sprint_id}/items').json())==2
    exported=client.get(f'/api/resources/sprints/{sprint_id}/export.csv')
    assert exported.status_code==200
    title,parsed=parse_tracker(exported.content)
    assert title=='Sprint_10B'
    assert parsed[0].completion_percent==200
    assert parsed[1].actual_hours is None
    assert parsed[0].comment=='Multiline\ncomment'


def test_task_edit_archive_restore_and_validation(client):
    sprint=client.post('/api/resources/sprints',json={'name':'New sprint'}).json()
    path=f"/api/resources/sprints/{sprint['id']}/items"
    body={'item_id':'ITEM-01','task':'Plan testing','tester':'Solai','estimated_hours':4,'actual_hours':2,'completion_percent':50}
    response=client.post(path,json=body)
    assert response.status_code==200, response.text
    item=response.json()
    assert client.put(f"/api/resources/items/{item['id']}",json={**body,'actual_hours':7,'status':'Completed'}).json()['actual_hours']==7
    assert client.post(path,json={**body,'actual_hours':-1}).status_code==422
    assert client.post(path,json={**body,'task':'   '}).status_code==422
    assert client.post(path,json={**body,'start_date':'2026-11-05','end_date':'2026-11-04'}).status_code==422
    assert client.patch(f"/api/resources/items/{item['id']}/archive",params={'archived':True}).status_code==200
    assert client.get(path).json()==[]
    assert len(client.get(path+'?include_archived=true').json())==1
    assert client.patch(f"/api/resources/items/{item['id']}/archive?archived=false").status_code==200
    assert len(client.get(path).json())==1
    assert client.post('/api/resources/sprints',json={'name':'New sprint'}).status_code==409


def test_timesheets_preserve_existing_hours_and_validate_intervals(client):
    sprint=client.post('/api/resources/sprints',json={'name':'Timesheets'}).json()
    path=f"/api/resources/sprints/{sprint['id']}/items"
    item=client.post(path,json={'item_id':'T-1','task':'Regression','actual_hours':3}).json()
    base=f"/api/resources/items/{item['id']}"
    entry={'member':'Tester','start_at':'2026-01-01T10:00:00+05:30','end_at':'2026-01-01T11:30:00+05:30','note':'Regression complete'}
    saved=client.post(base+'/timesheets',json=entry)
    assert saved.status_code==200, saved.text
    assert client.get(path).json()[0]['actual_hours']==4.5
    assert client.get(base+'/timesheets').json()[0]['note']=='Regression complete'
    assert client.post(base+'/timesheets',json={**entry,'end_at':entry['start_at']}).status_code==422
    assert client.post(base+'/timesheets',json={**entry,'end_at':'2099-01-01T00:00:00Z'}).status_code==422
    assert client.post(base+'/timesheets',json={**entry,'member':'  '}).status_code==422
    other=client.post(path,json={'item_id':'T-2','task':'Other task'}).json()
    assert client.delete(f"/api/resources/items/{other['id']}/timesheets/{saved.json()['id']}").status_code==404
    assert client.delete(base+f"/timesheets/{saved.json()['id']}").status_code==200
    assert client.get(path).json()[0]['actual_hours']==3
    assert client.get(base+'/timesheets').json()==[]


def test_timer_survives_reload_and_prevents_duplicate_start(client):
    sprint=client.post('/api/resources/sprints',json={'name':'Timers'}).json()
    path=f"/api/resources/sprints/{sprint['id']}/items"
    item=client.post(path,json={'item_id':'T-1','task':'Regression','tester':'Solai','actual_hours':2}).json()
    base=f"/api/resources/items/{item['id']}"
    started=client.post(base+'/timer/start')
    assert started.status_code==200, started.text
    assert started.json()['member']=='Solai'
    assert client.post(base+'/timer/start').status_code==409
    rows=client.get(base+'/timesheets').json()
    assert len(rows)==1 and rows[0]['end_at'] is None
    assert client.delete(base+f"/timesheets/{rows[0]['id']}").status_code==409
    stopped=client.post(base+'/timer/stop')
    assert stopped.status_code==200, stopped.text
    assert stopped.json()['end_at'] is not None
    assert client.get(path).json()[0]['actual_hours']>=2
    assert client.post(base+'/timer/stop').status_code==409
    client.patch(base+'/archive')
    assert client.post(base+'/timer/start').status_code==409
    client.post('/api/auth/logout')
    assert client.get(base+'/timesheets').status_code==401


def test_resource_email_settings_and_manual_summary(client, monkeypatch):
    settings_url='/api/resources/email-settings'
    initial=client.get(settings_url)
    assert initial.status_code==200
    assert initial.json()['recipient']=='kavaskar.docpanel@gmail.com'
    assert initial.json()['enabled'] is False
    saved=client.put(settings_url,json={
        'recipient':'kavaskar.docpanel@gmail.com','send_time':'18:30','enabled':True,
    })
    assert saved.status_code==200, saved.text
    assert saved.json()['send_time']=='18:30'
    assert saved.json()['enabled'] is True
    assert client.put(settings_url,json={
        'recipient':'not-an-email','send_time':'25:90','enabled':True,
    }).status_code==422

    sprint=client.post('/api/resources/sprints',json={'name':'Email sprint'}).json()
    item=client.post(f"/api/resources/sprints/{sprint['id']}/items",json={
        'item_id':'MAIL-01','task':'Run regression','tester':'Test Employee',
        'estimated_hours':4,'actual_hours':2,'status':'In Progress','comment':'Daily note',
    }).json()
    client.post(f"/api/resources/items/{item['id']}/timesheets",json={
        'member':'Test Employee','start_at':'2026-11-11T09:00:00+05:30',
        'end_at':'2026-11-11T10:00:00+05:30','note':'Worked on regression',
    })
    monkeypatch.setenv('RESOURCE_SMTP_HOST','smtp.gmail.com')
    monkeypatch.setenv('RESOURCE_SMTP_USERNAME','sender@example.test')
    monkeypatch.setenv('RESOURCE_SMTP_PASSWORD','app-password-for-test')
    monkeypatch.setenv('RESOURCE_SMTP_FROM','sender@example.test')
    messages=[]
    monkeypatch.setattr(resources,'smtp_send',messages.append)
    sent=client.post(settings_url+'/send-now')
    assert sent.status_code==200, sent.text
    assert sent.json()=={'sent':True,'recipient':'kavaskar.docpanel@gmail.com'}
    assert 'Test Employee' in messages[0].as_string()
    assert 'Run regression' in messages[0].as_string()
    assert 'Daily note' in messages[0].as_string()
    assert 'Worked on regression' in messages[0].as_string()
    assert 'app-password-for-test' not in messages[0].as_string()


def test_resource_email_daily_scheduler_sends_once_and_surfaces_missing_smtp(client, monkeypatch):
    settings_url='/api/resources/email-settings'
    assert client.put(settings_url,json={
        'recipient':'kavaskar.docpanel@gmail.com','send_time':'09:00','enabled':True,
    }).status_code==200
    for key,value in {
        'RESOURCE_SMTP_HOST':'smtp.gmail.com',
        'RESOURCE_SMTP_USERNAME':'sender@example.test',
        'RESOURCE_SMTP_PASSWORD':'app-password-for-test',
        'RESOURCE_SMTP_FROM':'sender@example.test',
    }.items():
        monkeypatch.setenv(key,value)
    sent=[]
    monkeypatch.setattr(resources,'smtp_send',sent.append)
    when=datetime(2026,11,11,9,1,tzinfo=ZoneInfo('Asia/Kolkata'))
    resources.process_due_resource_email(main.SessionLocal,when)
    resources.process_due_resource_email(main.SessionLocal,when)
    assert len(sent)==1
    with main.SessionLocal() as session:
        settings=session.get(ResourceEmailSettings,1)
        assert settings.last_sent_on.isoformat()=='2026-11-11'
        assert settings.last_error is None

    monkeypatch.delenv('RESOURCE_SMTP_HOST',raising=False)
    monkeypatch.delenv('RESOURCE_SMTP_USERNAME',raising=False)
    monkeypatch.delenv('RESOURCE_SMTP_PASSWORD',raising=False)
    monkeypatch.delenv('RESOURCE_SMTP_FROM',raising=False)
    next_day=datetime(2026,11,12,9,1,tzinfo=ZoneInfo('Asia/Kolkata'))
    resources.process_due_resource_email(main.SessionLocal,next_day)
    with main.SessionLocal() as session:
        settings=session.get(ResourceEmailSettings,1)
        assert settings.last_error=='Gmail SMTP is not configured on the backend.'


def test_invalid_import_is_atomic(client, source):
    malformed=tracker([
        ['ITEM-01','','Valid','','Solai','High','4','','','','Not Started','','','','','',''],
        ['ITEM-02','','Invalid','','Solai','High','-1','','','','Not Started','','','','','',''],
    ],'Broken sprint')
    response=import_csv(client,malformed)
    assert response.status_code==400
    assert 'row 5' in response.json()['detail']
    assert client.get('/api/resources/sprints').json()==[]
    assert import_csv(client,b'invalid header').status_code==400
    assert import_csv(client,b'\xff\xfe').status_code==400
    assert import_csv(client,tracker([])).status_code==400
    assert import_csv(client,source,'?sprint_id=99999').status_code==404


@pytest.mark.parametrize('role,allowed',[('viewer',False),('tester',False),('qa_lead',True),('test_lead',True)])
def test_team_tracker_role_checks(client, source, role, allowed):
    sprint=import_csv(client,source).json()
    sprint_id=sprint['sprint_id']
    item=client.get(f'/api/resources/sprints/{sprint_id}/items').json()[0]
    account={'email':f'{role}@test.local','name':role,'password':'valid-password-for-resource-tests','role':role}
    assert client.post('/api/users',json=account).status_code==200
    client.post('/api/auth/logout')
    assert client.post('/api/auth/login',json={'email':account['email'],'password':account['password']}).status_code==200
    expected=200 if allowed else 403
    for path in ['/api/resources/sprints',f'/api/resources/sprints/{sprint_id}/items',f'/api/resources/sprints/{sprint_id}/export.csv']:
        assert client.get(path).status_code==expected
    assert client.post('/api/resources/sprints',json={'name':'Another sprint'}).status_code==expected
    assert client.post(f'/api/resources/sprints/{sprint_id}/items',json={'item_id':'X','task':'Testing'}).status_code==expected
    assert client.put(f"/api/resources/items/{item['id']}",json={'item_id':'X','task':'Updated'}).status_code==expected
    assert client.patch(f"/api/resources/items/{item['id']}/archive").status_code==expected
    assert import_csv(client,tracker([['X','','Extra','','','High','','','','','Not Started','','','','','','']],'Extra')).status_code==expected
