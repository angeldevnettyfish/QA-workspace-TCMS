"""Team-wide sprint planning, workload tracking and spreadsheet interchange."""
import csv
import hashlib
import io
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .models import ResourceSprint, ResourceItem, ResourceImport

HEADERS = ['Item ID','Start Date','Sprint Item / Task','Test Activity','Tester','Priority',
           'Est. Hrs','Actual Hrs','Completion %','End Date','Status','Impediment',
           'Release','Unplanned Hrs','Test Cases','Defects','Comment']
FIELDS = ['item_id','start_date','task','activity','tester','priority','estimated_hours',
          'actual_hours','completion_percent','end_date','status','impediment','release',
          'unplanned_hours','test_cases','defects','comment']
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class SprintIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('Sprint name is required')
        return value.strip()


class ItemIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    item_id: str = Field(min_length=1, max_length=80)
    start_date: date | None = None
    task: str = Field(min_length=1, max_length=10000)
    activity: str = Field(default='', max_length=120)
    tester: str = Field(default='', max_length=120)
    priority: str = Field(default='Medium', max_length=30)
    estimated_hours: Nonnegative | None = None
    actual_hours: Nonnegative | None = None
    # The source sheet uses explicit percentages, including 200% and 375%.
    completion_percent: Nonnegative | None = None
    end_date: date | None = None
    status: str = Field(default='Not Started', min_length=1, max_length=60)
    impediment: str = Field(default='', max_length=200)
    release: str = Field(default='', max_length=200)
    unplanned_hours: Nonnegative | None = None
    test_cases: int | None = Field(default=None, ge=0)
    defects: int | None = Field(default=None, ge=0)
    comment: str = Field(default='', max_length=20000)

    @model_validator(mode='after')
    def check_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError('End date must be on or after start date')
        return self


def parse_tracker(raw):
    try:
        rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig')), strict=True))
    except (UnicodeDecodeError, csv.Error):
        raise HTTPException(400, 'Upload a UTF-8 CSV tracker') from None
    header_index = next((i for i,r in enumerate(rows) if [v.strip() for v in r] == HEADERS), None)
    if header_index is None:
        raise HTTPException(400, 'CSV must contain the 17 Sprint Testing Tracker column headers')
    title = next((r[0].strip() for r in rows[:header_index] if r and r[0].strip()), '')
    items = []
    for line, row in enumerate(rows[header_index+1:], header_index+2):
        if not any(cell.strip() for cell in row):
            continue
        # Ignore sheet footer notes, not partial task records.
        if len(row) == len(HEADERS) and not any(cell.strip() for cell in row[:16]):
            continue
        if len(row) != len(HEADERS):
            raise HTTPException(400, f'CSV row {line}: expected 17 columns')
        values = dict(zip(FIELDS, (value.strip() for value in row)))
        try:
            for key in ('start_date', 'end_date'):
                value = values[key]
                if not value:
                    values[key] = None
                else:
                    try:
                        values[key] = date.fromisoformat(value)
                    except ValueError:
                        values[key] = datetime.strptime(value, '%d %b %Y').date()
            for key in ('estimated_hours','actual_hours','unplanned_hours','test_cases','defects'):
                values[key] = values[key] or None
            values['completion_percent'] = values['completion_percent'].removesuffix('%') or None
            items.append(ItemIn.model_validate(values))
        except ValueError as exc:
            raise HTTPException(400, f'CSV row {line}: {exc}') from None
    if not items:
        raise HTTPException(400, 'CSV contains no task rows')
    return title, items


def import_tracker(session, raw, sprint_id=None):
    title, items = parse_tracker(raw)
    sprint = session.get(ResourceSprint, sprint_id) if sprint_id else session.scalar(
        select(ResourceSprint).where(ResourceSprint.name == title))
    if sprint_id and sprint is None:
        raise HTTPException(404, 'Sprint not found')
    if sprint is None:
        try:
            name = SprintIn(name=title or 'Imported sprint').name
        except ValueError:
            raise HTTPException(400, 'CSV sprint title must contain 1–120 characters') from None
        sprint = ResourceSprint(name=name)
        session.add(sprint)
        session.flush()
    checksum = hashlib.sha256(raw).hexdigest()
    if session.scalar(select(ResourceImport.id).where(ResourceImport.sprint_id==sprint.id, ResourceImport.checksum==checksum)):
        raise HTTPException(409, 'This CSV has already been imported into this sprint')
    for item in items:
        session.add(ResourceItem(sprint_id=sprint.id, **item.model_dump()))
    session.add(ResourceImport(sprint_id=sprint.id, checksum=checksum))
    session.flush()
    return {'sprint_id':sprint.id, 'sprint_name':sprint.name, 'imported':len(items)}


def create_resource_router(db, user, elevated, obj, data, audit):
    router = APIRouter(prefix='/api/resources', tags=['Resource management'])

    def manager(u=Depends(user)):
        elevated(u)
        return u

    @router.get('/sprints')
    def sprints(s:Session=Depends(db), u=Depends(manager)):
        return [data(row) for row in s.scalars(select(ResourceSprint).order_by(ResourceSprint.id.desc()))]

    @router.post('/sprints')
    def create_sprint(body:SprintIn, s:Session=Depends(db), u=Depends(manager)):
        sprint = ResourceSprint(name=body.name)
        s.add(sprint)
        try:
            s.flush()
            audit(s,u.id,'create','resource_sprint',sprint.id,after={'name':sprint.name})
            s.commit()
        except IntegrityError:
            s.rollback()
            raise HTTPException(409, 'A sprint with this name already exists') from None
        return data(sprint)

    @router.get('/sprints/{sprint_id}/items')
    def items(sprint_id:int, include_archived:bool=False, s:Session=Depends(db), u=Depends(manager)):
        obj(s,ResourceSprint,sprint_id)
        query = select(ResourceItem).where(ResourceItem.sprint_id==sprint_id)
        if not include_archived:
            query = query.where(ResourceItem.archived.is_(False))
        return [data(row) for row in s.scalars(query.order_by(ResourceItem.id))]

    @router.post('/sprints/{sprint_id}/items')
    def create_item(sprint_id:int, body:ItemIn, s:Session=Depends(db), u=Depends(manager)):
        obj(s,ResourceSprint,sprint_id)
        item = ResourceItem(sprint_id=sprint_id, **body.model_dump())
        s.add(item)
        s.flush()
        audit(s,u.id,'create','resource_item',item.id,after=data(item))
        s.commit()
        return data(item)

    @router.put('/items/{item_id}')
    def update_item(item_id:int, body:ItemIn, s:Session=Depends(db), u=Depends(manager)):
        item = obj(s,ResourceItem,item_id)
        before = data(item)
        for key,value in body.model_dump().items():
            setattr(item,key,value)
        s.flush()
        audit(s,u.id,'update','resource_item',item.id,before=before,after=data(item))
        s.commit()
        return data(item)

    @router.patch('/items/{item_id}/archive')
    def archive(item_id:int, archived:bool=True, s:Session=Depends(db), u=Depends(manager)):
        item = obj(s,ResourceItem,item_id)
        item.archived = archived
        audit(s,u.id,'archive' if archived else 'restore','resource_item',item.id)
        s.commit()
        return data(item)

    @router.post('/import')
    async def import_csv(sprint_id:int|None=None, file:UploadFile=File(...), s:Session=Depends(db), u=Depends(manager)):
        if not (file.filename or '').lower().endswith('.csv'):
            raise HTTPException(415, 'Upload a .csv file')
        raw = await file.read(2_000_001)
        if len(raw)>2_000_000:
            raise HTTPException(413, 'CSV exceeds the 2 MB limit')
        try:
            result = import_tracker(s,raw,sprint_id)
            audit(s,u.id,'import','resource_sprint',result['sprint_id'],after=result)
            s.commit()
        except IntegrityError:
            s.rollback()
            raise HTTPException(409, 'This sprint or CSV import already exists; reload and retry') from None
        return result

    @router.get('/sprints/{sprint_id}/export.csv')
    def export_csv(sprint_id:int, s:Session=Depends(db), u=Depends(manager)):
        sprint = obj(s,ResourceSprint,sprint_id)
        buf = io.StringIO()
        writer = csv.writer(buf)
        def cell(value):
            if isinstance(value,date):
                return value.strftime('%d %b %Y')
            if value is None:
                return ''
            if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@')):
                return "'"+value
            return value
        writer.writerow([cell(sprint.name)]+['']*16)
        writer.writerow(['']*17)
        writer.writerow(HEADERS)
        for item in s.scalars(select(ResourceItem).where(ResourceItem.sprint_id==sprint_id, ResourceItem.archived.is_(False)).order_by(ResourceItem.id)):
            values = [cell(getattr(item,field)) for field in FIELDS]
            values[8] = f'{item.completion_percent:g}%' if item.completion_percent is not None else ''
            writer.writerow(values)
        return StreamingResponse(iter(['\ufeff'+buf.getvalue()]),media_type='text/csv',headers={
            'Content-Disposition':f'attachment; filename="sprint-{sprint_id}-tracker.csv"'})

    return router
