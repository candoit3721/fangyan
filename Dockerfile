# ==============================================================================
# Dockerfile for Qwen3 ASR Flash Web Application
# Multi-cloud & Render Ready
# ==============================================================================

FROM python:3.11-slim

# Prevent Python from writing .pyc and buffer stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8765

WORKDIR /app

# Install system dependencies (including ffmpeg for universal audio normalization)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY asr_app /app/asr_app
COPY run_asr.py /app/run_asr.py

# Create persistent data and uploads directory
RUN mkdir -p /app/asr_app/data/uploads

# Expose standard port
EXPOSE 8765

# Default execution command - binds to 0.0.0.0 and reads $PORT automatically
CMD ["python3", "run_asr.py", "--host", "0.0.0.0", "--no-browser"]
