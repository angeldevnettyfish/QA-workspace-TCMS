import csv
import io
import pytest
from test_srs_workflows import client
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
