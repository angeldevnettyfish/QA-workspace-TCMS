import pytest
from sqlalchemy.engine import make_url

from app.config import database_url


def test_postgres_credentials_with_url_special_characters():
    settings = {
        'DB_HOST': '192.168.1.10',
        'DB_PORT': '5433',
        'DB_NAME': 'qa_manager',
        'DB_USER': 'qa@team',
        'DB_PASSWORD': 'secret@:/#% space',
    }
    url = make_url(database_url(settings))
    assert url.drivername == 'postgresql+psycopg'
    assert url.username == settings['DB_USER']
    assert url.password == settings['DB_PASSWORD']
    assert url.host == settings['DB_HOST']
    assert url.port == 5433
    assert url.database == settings['DB_NAME']


def test_explicit_url_overrides_fields_and_sqlite_remains_available():
    assert database_url({'DATABASE_URL': 'sqlite:///test.db', 'DB_HOST': 'unused'}) == 'sqlite:///test.db'
    assert database_url({}) == 'sqlite:///./dev.db'


def test_incomplete_postgres_settings_fail_instead_of_using_sqlite():
    with pytest.raises(ValueError, match='DB_NAME'):
        database_url({'DB_HOST': 'localhost'})


@pytest.mark.parametrize('port', ['0', '65536', 'invalid'])
def test_invalid_port_is_rejected(port):
    with pytest.raises(ValueError):
        database_url({'DB_HOST': 'localhost', 'DB_PORT': port})
