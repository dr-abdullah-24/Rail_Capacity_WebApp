"""Serve the existing API and built UI on a private, OS-assigned loopback port."""
import json
import socket
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.main import app as api, lifespan

DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'


def create_app():
    if not (DIST / 'index.html').is_file():
        raise RuntimeError('Build the frontend first: cd frontend && npm run build')
    desktop = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
    desktop.mount('/api', api)
    desktop.mount('/', StaticFiles(directory=DIST, html=True), name='frontend')
    return desktop


if __name__ == '__main__':
    server_app = create_app()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        print(json.dumps({'desktop_port': listener.getsockname()[1]}), flush=True)
        uvicorn.Server(uvicorn.Config(server_app, log_level='warning')).run(sockets=[listener])
