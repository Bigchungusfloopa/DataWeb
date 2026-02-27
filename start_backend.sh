#!/bin/bash
# DataChat — Start Backend
# Usage: bash start_backend.sh

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r backend/requirements.txt
else
  source venv/bin/activate
fi

echo ""
echo "🚀 Starting DataChat Backend..."
echo "   API:     http://localhost:8000"
echo "   Swagger: http://localhost:8000/docs"
echo "   Health:  http://localhost:8000/health"
echo ""
echo "Make sure Ollama is running: ollama serve"
echo "Make sure llama3.1:8b is pulled: ollama pull llama3.1:8b"
echo ""

python3 -m uvicorn backend.main:app --reload --port 8000
