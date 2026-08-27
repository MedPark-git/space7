"""WSGI 진입점. 일부 런타임은 wsgi:application 을 기본으로 찾는다."""
from app import app

application = app
