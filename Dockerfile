# Django API only; the frontend is served by the Cloudflare Worker in frontend/ (see the README).
FROM python:3.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DEBUG=0 PORT=8000
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
RUN useradd --create-home app
USER app
EXPOSE 8000

# One process with threads keeps a single LocMemCache (weather cells, routes), so repeat trips stay cache hits.
CMD gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 60 --access-logfile -
