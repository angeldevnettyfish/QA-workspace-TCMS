"""Shared database models used by API modules."""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean, JSON, UniqueConstraint, Index, LargeBinary, Float, Date
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class AutomationSchedule(Base):
    __tablename__ = 'automation_schedules'
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    cycle_id = Column(Integer, ForeignKey('cycles.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    name = Column(String(120), nullable=False)
    frequency = Column(String(10), nullable=False)
    timezone = Column(String(40), nullable=False)
    start_at = Column(DateTime(timezone=True), nullable=False)
    next_run_at = Column(DateTime(timezone=True), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=True)
    last_run_id = Column(Integer, ForeignKey('automation_runs.id'))
    last_error = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: now())

class AutomationHtmlReport(Base):
    __tablename__ = 'automation_html_reports'
    run_id = Column(Integer, ForeignKey('automation_runs.id'), primary_key=True)
    content = Column(LargeBinary, nullable=False)

class BitbucketConfig(Base):
    __tablename__ = 'bitbucket_configs'
    project_id = Column(Integer, ForeignKey('projects.id'), primary_key=True)
    workspace = Column(String(100), nullable=False)
    repository = Column(String(100), nullable=False)
    branch = Column(String(200), nullable=False)
    pipeline = Column(String(200), nullable=False)

class AutomationTestResults(Base):
    __tablename__ = 'automation_test_results'
    run_id = Column(Integer, ForeignKey('automation_runs.id'), primary_key=True)
    tests = Column(JSON, nullable=False, default=list)

class AutomationRun(Base):
    __tablename__ = 'automation_runs'
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    cycle_id = Column(Integer, ForeignKey('cycles.id'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    workspace = Column(String(100), nullable=False)
    repository = Column(String(100), nullable=False)
    branch = Column(String(200), nullable=False)
    pipeline = Column(String(200), nullable=False)
    source = Column(String(20), nullable=False, default='bitbucket', server_default='bitbucket')
    local_script = Column(String(120))
    pipeline_uuid = Column(String(100))
    build_number = Column(Integer)
    state = Column(String(40), nullable=False, default='TRIGGERING')
    result = Column(String(40))
    error = Column(Text)
    callback_hash = Column(String(64), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    import_id = Column(Integer, ForeignKey('import_logs.id'))
    created_at = Column(DateTime(timezone=True), default=lambda: now())

def now(): return datetime.now(timezone.utc)
class User(Base):
    __tablename__='users'
    id=Column(Integer,primary_key=True); email=Column(String(255),unique=True,nullable=False); name=Column(String(120),nullable=False); password_hash=Column(String(300),nullable=False); role=Column(String(20),default='tester'); roles=Column(JSON,nullable=False,default=list); active=Column(Boolean,default=True)
class Project(Base):
    __tablename__='projects'
    id=Column(Integer,primary_key=True); key=Column(String(40),unique=True); name=Column(String(180),nullable=False); description=Column(Text,default=''); archived=Column(Boolean,default=False,nullable=False); created_at=Column(DateTime(timezone=True),default=now)
class Membership(Base):
    __tablename__='memberships'; __table_args__=(UniqueConstraint('project_id','user_id'),)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); user_id=Column(Integer,ForeignKey('users.id'),nullable=False); role=Column(String(20),default='tester',nullable=False)
class TestFolder(Base):
    __tablename__='test_folders'; __table_args__=(UniqueConstraint('project_id','name'),)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); parent_id=Column(Integer,ForeignKey('test_folders.id'),nullable=True); name=Column(String(180),nullable=False)
class TestCase(Base):
    __tablename__='test_cases'
    import_metadata=Column(JSON,nullable=False,default=dict)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); folder_id=Column(Integer,ForeignKey('test_folders.id'),nullable=True); title=Column(String(300),nullable=False); priority=Column(String(20),default='Medium'); kind=Column(String(20),default='Manual'); status=Column(String(30),default='Active'); version=Column(Integer,default=1); archived=Column(Boolean,default=False); author_id=Column(Integer,ForeignKey('users.id'),nullable=True); created_at=Column(DateTime(timezone=True),default=now); updated_at=Column(DateTime(timezone=True),default=now,onupdate=now); custom_values=Column(JSON,default=dict)
class CaseVersion(Base):
    __tablename__='case_versions'; __table_args__=(UniqueConstraint('case_id','version'),)
    id=Column(Integer,primary_key=True); case_id=Column(Integer,ForeignKey('test_cases.id'),nullable=False); version=Column(Integer,nullable=False); preconditions=Column(Text,default=''); steps=Column(JSON,default=list); author_id=Column(Integer,ForeignKey('users.id'),nullable=True); created_at=Column(DateTime(timezone=True),default=now)
class TestPlan(Base):
    __tablename__='test_plans'
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); name=Column(String(200),nullable=False); release=Column(String(100),default=''); scope=Column(Text,default=''); owner_id=Column(Integer,ForeignKey('users.id'),nullable=True); archived=Column(Boolean,default=False)
class PlanCase(Base):
    __tablename__='plan_cases'; __table_args__=(UniqueConstraint('plan_id','case_id'),)
    id=Column(Integer,primary_key=True); plan_id=Column(Integer,ForeignKey('test_plans.id'),nullable=False); case_id=Column(Integer,ForeignKey('test_cases.id'),nullable=False)
class Cycle(Base):
    __tablename__='cycles'
    id=Column(Integer,primary_key=True); plan_id=Column(Integer,ForeignKey('test_plans.id'),nullable=False); name=Column(String(200),nullable=False); environment=Column(String(100),default='QA'); start_date=Column(DateTime(timezone=True),nullable=True); end_date=Column(DateTime(timezone=True),nullable=True)
class CycleCase(Base):
    __tablename__='cycle_cases'; __table_args__=(UniqueConstraint('cycle_id','case_id'),)
    id=Column(Integer,primary_key=True); cycle_id=Column(Integer,ForeignKey('cycles.id'),nullable=False); case_id=Column(Integer,ForeignKey('test_cases.id'),nullable=False); version_id=Column(Integer,ForeignKey('case_versions.id'),nullable=False); assigned_to=Column(Integer,ForeignKey('users.id'),nullable=True)
class Execution(Base):
    __tablename__='executions'
    id=Column(Integer,primary_key=True); cycle_case_id=Column(Integer,ForeignKey('cycle_cases.id'),nullable=False); user_id=Column(Integer,ForeignKey('users.id'),nullable=True); status=Column(String(20),nullable=False); source=Column(String(20),default='Manual'); notes=Column(Text,default=''); actual_result=Column(Text,default=''); step_results=Column(JSON,default=list); duration=Column(String(30),default=''); created_at=Column(DateTime(timezone=True),default=now)
class Defect(Base):
    __tablename__='defects'
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); title=Column(String(300),nullable=False); description=Column(Text,default=''); severity=Column(String(20),default='Medium'); priority=Column(String(20),default='Medium'); status=Column(String(30),default='New'); assigned_to=Column(Integer,ForeignKey('users.id'),nullable=True); execution_id=Column(Integer,ForeignKey('executions.id'),nullable=True); created_at=Column(DateTime(timezone=True),default=now); updated_at=Column(DateTime(timezone=True),default=now,onupdate=now)
class DefectExecution(Base):
    __tablename__='defect_executions'; __table_args__=(UniqueConstraint('defect_id','execution_id'),)
    id=Column(Integer,primary_key=True); defect_id=Column(Integer,ForeignKey('defects.id'),nullable=False); execution_id=Column(Integer,ForeignKey('executions.id'),nullable=False)
class AutomationMap(Base):
    __tablename__='automation_maps'; __table_args__=(UniqueConstraint('project_id','external_id'),)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); external_id=Column(String(400),nullable=False); case_id=Column(Integer,ForeignKey('test_cases.id'),nullable=False)
class ImportLog(Base):
    __tablename__='import_logs'; __table_args__=(UniqueConstraint('cycle_id','checksum'),)
    id=Column(Integer,primary_key=True); cycle_id=Column(Integer,ForeignKey('cycles.id'),nullable=False); filename=Column(String(255)); checksum=Column(String(64),nullable=True); imported=Column(Integer,default=0); unmatched=Column(JSON,default=list); errors=Column(JSON,default=list); created_at=Column(DateTime(timezone=True),default=now)
class Attachment(Base):
    __tablename__='attachments'
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); execution_id=Column(Integer,ForeignKey('executions.id'),nullable=True); filename=Column(String(255),nullable=False); content_type=Column(String(100),nullable=False); size=Column(Integer,nullable=False); storage_key=Column(String(80),unique=True,nullable=False); uploaded_by=Column(Integer,ForeignKey('users.id'),nullable=False); created_at=Column(DateTime(timezone=True),default=now)
class AuditEvent(Base):
    __tablename__='audit_events'; __table_args__=(Index('ix_audit_project_created','project_id','created_at'),)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=True); actor_id=Column(Integer,ForeignKey('users.id'),nullable=True); action=Column(String(80),nullable=False); entity_type=Column(String(80),nullable=False); entity_id=Column(String(80),nullable=False); before=Column(JSON,nullable=True); after=Column(JSON,nullable=True); created_at=Column(DateTime(timezone=True),default=now)
class ApiToken(Base):
    __tablename__='api_tokens'
    id=Column(Integer,primary_key=True); name=Column(String(120),nullable=False); token_hash=Column(String(64),unique=True,nullable=False); prefix=Column(String(12),nullable=False); user_id=Column(Integer,ForeignKey('users.id'),nullable=False); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); expires_at=Column(DateTime(timezone=True),nullable=True); revoked=Column(Boolean,default=False); created_at=Column(DateTime(timezone=True),default=now)
class Notification(Base):
    __tablename__='notifications'; __table_args__=(Index('ix_notifications_user_created','user_id','created_at'),)
    id=Column(Integer,primary_key=True); user_id=Column(Integer,ForeignKey('users.id'),nullable=False); title=Column(String(200),nullable=False); message=Column(Text,nullable=False); link=Column(String(300),default=''); read=Column(Boolean,default=False); created_at=Column(DateTime(timezone=True),default=now)
class RequirementRecord(Base):
    __tablename__='requirements'; __table_args__=(UniqueConstraint('project_id','key'),)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); key=Column(String(80),nullable=False); title=Column(String(300),nullable=False); description=Column(Text,default=''); status=Column(String(30),default='Active'); created_at=Column(DateTime(timezone=True),default=now)
class RequirementCase(Base):
    __tablename__='requirement_cases'; __table_args__=(UniqueConstraint('requirement_id','case_id'),)
    id=Column(Integer,primary_key=True); requirement_id=Column(Integer,ForeignKey('requirements.id'),nullable=False); case_id=Column(Integer,ForeignKey('test_cases.id'),nullable=False)
class CustomField(Base):
    __tablename__='custom_fields'; __table_args__=(UniqueConstraint('project_id','name'),)
    id=Column(Integer,primary_key=True); project_id=Column(Integer,ForeignKey('projects.id'),nullable=False); name=Column(String(100),nullable=False); field_type=Column(String(20),nullable=False); required=Column(Boolean,default=False); options=Column(JSON,default=list)


class ResourceSprint(Base):
    __tablename__ = 'resource_sprints'
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), default=now)


class ResourceItem(Base):
    __tablename__ = 'resource_items'
    id = Column(Integer, primary_key=True)
    sprint_id = Column(Integer, ForeignKey('resource_sprints.id'), nullable=False, index=True)
    item_id = Column(String(80), nullable=False)
    start_date = Column(Date)
    task = Column(Text, nullable=False)
    activity = Column(String(120), nullable=False, default='')
    tester = Column(String(120), nullable=False, default='')
    priority = Column(String(30), nullable=False, default='Medium')
    estimated_hours = Column(Float)
    actual_hours = Column(Float)
    completion_percent = Column(Float)
    end_date = Column(Date)
    status = Column(String(60), nullable=False, default='Not Started')
    impediment = Column(String(200), nullable=False, default='')
    release = Column(String(200), nullable=False, default='')
    unplanned_hours = Column(Float)
    test_cases = Column(Integer)
    defects = Column(Integer)
    comment = Column(Text, nullable=False, default='')
    archived = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)


class ResourceImport(Base):
    __tablename__ = 'resource_imports'
    id = Column(Integer, primary_key=True)
    sprint_id = Column(Integer, ForeignKey('resource_sprints.id'), nullable=False)
    checksum = Column(String(64), nullable=False)
    __table_args__ = (UniqueConstraint('sprint_id', 'checksum'),)


class ResourceTimeEntry(Base):
    __tablename__ = 'resource_time_entries'
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey('resource_items.id'), nullable=False, index=True)
    member = Column(String(120), nullable=False)
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True))
    note = Column(Text, nullable=False, default='')


class ResourceEmailSettings(Base):
    __tablename__ = 'resource_email_settings'
    id = Column(Integer, primary_key=True)
    recipient = Column(String(320), nullable=False)
    send_time = Column(String(5), nullable=False, default='09:00')
    enabled = Column(Boolean, nullable=False, default=False)
    last_attempt_on = Column(Date)
    last_sent_on = Column(Date)
    last_error = Column(Text)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
