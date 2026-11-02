import os
from collections.abc import Mapping

from sqlalchemy.engine import URL


def database_url(environ: Mapping[str, str] | None = None) -> str:
    settings = os.environ if environ is None else environ
    # An explicit URL remains available for existing deployments and SQLite tests.
    if settings.get('DATABASE_URL'):
        return settings['DATABASE_URL']
    if not settings.get('DB_HOST'):
        return 'sqlite:///./dev.db'
    port = int(settings.get('DB_PORT', '5432'))
    if not 1 <= port <= 65535:
        raise ValueError('DB_PORT must be between 1 and 65535')
    for key in ('DB_NAME', 'DB_USER', 'DB_PASSWORD'):
        if not settings.get(key):
            raise ValueError(f'Set {key} in .env when DB_HOST is configured')
    return URL.create(
        'postgresql+psycopg',
        username=settings['DB_USER'],
        password=settings['DB_PASSWORD'],
        host=settings['DB_HOST'],
        port=port,
        database=settings['DB_NAME'],
    ).render_as_string(hide_password=False)
