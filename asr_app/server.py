"""Local ASR Web Server & API Backend.
Provides REST endpoints for recording upload, transcription polling, audio streaming,
settings configuration, history management, and multi-format export.
"""

import email
from email import policy
from email.parser import BytesParser
import io
import json
import logging
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import urllib.parse
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, List, Optional

from asr_app.asr_service import ASRService, AVAILABLE_MODELS, asr_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("asr_server")

# Base paths
BASE_DIR = Path(__file__).parent.resolve()
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
HISTORY_FILE = DATA_DIR / "history.json"

# Ensure directories exist
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


class HistoryManager:
    """Manages transcription history persistence in local JSON."""
    def __init__(self, filepath: Path):
        self.filepath = filepath
        self._lock = threading.Lock()
        self._items: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        with self._lock:
            if self.filepath.exists():
                try:
                    with open(self.filepath, "r", encoding="utf-8") as f:
                        self._items = json.load(f)
                except Exception as e:
                    logger.error(f"Failed to load history: {e}")
                    self._items = {}
            else:
                self._items = {}

    def _save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self._items, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save history: {e}")

    def add(self, session_id: str, data: Dict[str, Any]):
        with self._lock:
            self._items[session_id] = data
            self._save()

    def get(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._items.get(session_id)

    def list_all(self) -> List[Dict[str, Any]]:
        with self._lock:
            # Sort newest first
            items = list(self._items.values())
            items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
            return items

    def delete(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._items:
                item = self._items.pop(session_id)
                self._save()
                # Clean up uploaded audio file if present
                audio_file = item.get("audio_path")
                if audio_file and os.path.exists(audio_file):
                    try:
                        os.remove(audio_file)
                    except Exception:
                        pass
                return True
            return False


history_manager = HistoryManager(HISTORY_FILE)


class ASRRequestHandler(SimpleHTTPRequestHandler):
    """Custom HTTP Request Handler for ASR application."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, format, *args):
        # Concise logging
        logger.info("%s - %s", self.address_string(), format % args)

    def _send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, message: str, status: int = 400):
        self._send_json({"error": message, "status": "ERROR"}, status=status)

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()

    def _is_auth_required(self) -> bool:
        """Check if passcode protection is configured via environment variable."""
        passcode = os.environ.get("APP_PASSCODE", "").strip() or os.environ.get("ACCESS_TOKEN", "").strip() or os.environ.get("AUTH_PASSCODE", "").strip()
        return bool(passcode)

    def _is_authenticated(self) -> bool:
        """Verify request authentication token or passcode."""
        required = os.environ.get("APP_PASSCODE", "").strip() or os.environ.get("ACCESS_TOKEN", "").strip() or os.environ.get("AUTH_PASSCODE", "").strip()
        if not required:
            return True

        # 1. Bearer token in Authorization header
        auth_header = self.headers.get("Authorization", "").strip()
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            if token == required:
                return True

        # 2. Custom header
        if self.headers.get("X-App-Passcode", "").strip() == required:
            return True
        if self.headers.get("X-Access-Token", "").strip() == required:
            return True

        # 3. Cookie check
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            for c in cookie_header.split(";"):
                c = c.strip()
                if c.startswith("app_passcode=") and c[13:] == required:
                    return True
                if c.startswith("access_token=") and c[13:] == required:
                    return True

        # 4. Query parameter (e.g. for audio streaming/download links)
        parsed_url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed_url.query)
        if query.get("token", [""])[0] == required or query.get("passcode", [""])[0] == required:
            return True

        return False

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # 0. Auth status check (public)
        if path == "/api/auth/status":
            auth_req = self._is_auth_required()
            is_authed = self._is_authenticated()
            return self._send_json({
                "auth_required": auth_req,
                "authenticated": is_authed,
            })

        # Enforce authentication on all other /api/ endpoints if passcode protection is enabled
        if path.startswith("/api/") and self._is_auth_required() and not self._is_authenticated():
            return self._send_json({
                "error": "Authentication required. Please provide valid passcode.",
                "auth_required": True,
            }, 401)

        # 1. Config endpoint
        if path == "/api/config":
            has_dashscope_key = bool(os.environ.get("DASHSCOPE_API_KEY", "").strip())
            has_openrouter_key = bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
            auth_required = self._is_auth_required()

            masked_dashscope_key = ""
            if has_dashscope_key:
                raw = os.environ.get("DASHSCOPE_API_KEY", "").strip()
                masked_dashscope_key = raw[:6] + "..." + raw[-4:] if len(raw) > 10 else "******"

            masked_openrouter_key = ""
            if has_openrouter_key:
                raw = os.environ.get("OPENROUTER_API_KEY", "").strip()
                masked_openrouter_key = raw[:8] + "..." + raw[-4:] if len(raw) > 12 else "******"

            return self._send_json({
                "models": AVAILABLE_MODELS,
                "default_model": "qwen/qwen3-asr-flash-2026-02-10",
                "has_env_api_key": has_openrouter_key or has_dashscope_key,
                "has_openrouter_key": has_openrouter_key,
                "has_dashscope_key": has_dashscope_key,
                "masked_openrouter_key": masked_openrouter_key,
                "masked_dashscope_key": masked_dashscope_key,
                "auth_required": auth_required,
            })

        # 1.1 Refresh models from OpenRouter
        elif path == "/api/models/refresh":
            refreshed_models = asr_service.fetch_openrouter_qwen_models()
            return self._send_json({"models": refreshed_models, "count": len(refreshed_models)})

        # 2. History list
        elif path == "/api/history":
            items = history_manager.list_all()
            # Omit huge raw data in summary list for speed
            summaries = []
            for item in items:
                summaries.append({
                    "session_id": item.get("session_id"),
                    "filename": item.get("filename", "Audio Recording"),
                    "model": item.get("model"),
                    "created_at": item.get("created_at"),
                    "duration_str": item.get("duration_str", ""),
                    "status": item.get("status"),
                    "preview_text": (item.get("full_text", "")[:120] + "...") if item.get("full_text") else "",
                    "audio_url": item.get("audio_url"),
                    "sentence_count": len(item.get("sentences", [])),
                })
            return self._send_json({"history": summaries})

        # 3. Specific session detail
        elif path.startswith("/api/history/"):
            session_id = path[len("/api/history/"):]
            item = history_manager.get(session_id)
            if item:
                return self._send_json(item)
            return self._send_error("Session not found", 404)

        # 4. Task status query
        elif path.startswith("/api/task/"):
            task_id = path[len("/api/task/"):]
            session_id = query.get("session_id", [None])[0]
            api_key = self.headers.get("X-DashScope-Api-Key") or query.get("api_key", [None])[0]

            try:
                task_data = asr_service.fetch_task_status(task_id, api_key=api_key)
                
                # If finished and session_id given, update history
                if task_data.get("status") == "SUCCEEDED" and session_id:
                    session = history_manager.get(session_id)
                    if session:
                        session.update({
                            "status": "SUCCEEDED",
                            "full_text": task_data.get("full_text", ""),
                            "sentences": task_data.get("sentences", []),
                            "duration_ms": task_data.get("duration_ms", 0),
                            "duration_str": task_data.get("duration_str", ""),
                            "transcription_url": task_data.get("transcription_url"),
                            "details": task_data.get("details", {}),
                        })
                        history_manager.add(session_id, session)
                elif task_data.get("status") == "FAILED" and session_id:
                    session = history_manager.get(session_id)
                    if session:
                        session.update({
                            "status": "FAILED",
                            "error_message": task_data.get("error_message", "Transcription failed"),
                        })
                        history_manager.add(session_id, session)

                return self._send_json(task_data)
            except Exception as e:
                logger.error(f"Error checking task {task_id}: {e}")
                return self._send_error(str(e), 500)

        # 5. Audio streaming endpoint with Range header support
        elif path.startswith("/api/audio/"):
            filename = urllib.parse.unquote(path[len("/api/audio/"):])
            # Sanitize filename
            safe_filename = os.path.basename(filename)
            file_path = UPLOADS_DIR / safe_filename

            if not file_path.exists():
                return self._send_error("Audio file not found", 404)

            return self._stream_audio_file(str(file_path))

        # 6. Export endpoint
        elif path.startswith("/api/export/"):
            parts = path[len("/api/export/"):].split("/")
            if len(parts) >= 2:
                session_id, export_format = parts[0], parts[1].lower()
                session = history_manager.get(session_id)
                if not session:
                    return self._send_error("Session not found", 404)

                full_text = session.get("full_text", "")
                sentences = session.get("sentences", [])
                filename = session.get("filename", "transcript")
                base_name = os.path.splitext(filename)[0]

                if export_format == "txt":
                    content = full_text.encode("utf-8")
                    return self._send_download(content, f"{base_name}_transcript.txt", "text/plain; charset=utf-8")
                elif export_format == "md":
                    md_text = asr_service.generate_markdown(
                        full_text,
                        sentences,
                        model_name=session.get("model", ""),
                        duration_str=session.get("duration_str", ""),
                    )
                    return self._send_download(md_text.encode("utf-8"), f"{base_name}_transcript.md", "text/markdown; charset=utf-8")
                elif export_format == "srt":
                    srt_text = asr_service.generate_srt(sentences)
                    return self._send_download(srt_text.encode("utf-8"), f"{base_name}_subtitles.srt", "text/plain; charset=utf-8")
                elif export_format == "json":
                    json_data = json.dumps(session, ensure_ascii=False, indent=2).encode("utf-8")
                    return self._send_download(json_data, f"{base_name}_transcript.json", "application/json; charset=utf-8")
                else:
                    return self._send_error(f"Unsupported format: {export_format}", 400)

        # 7. Static file routing (Frontend SPA)
        if path == "/" or path == "/index.html":
            return self._serve_static_file(STATIC_DIR / "index.html", "text/html")
        else:
            # Check if static file exists
            rel_path = path.lstrip("/")
            static_file = STATIC_DIR / rel_path
            if static_file.exists() and static_file.is_file():
                mime_type, _ = mimetypes.guess_type(str(static_file))
                return self._serve_static_file(static_file, mime_type or "application/octet-stream")
            # Default fallback to index.html for SPA routing
            return self._serve_static_file(STATIC_DIR / "index.html", "text/html")

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # 0. Login endpoint (public)
        if path == "/api/auth/login":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body) if body else {}
                passcode = data.get("passcode", "").strip()
                required = os.environ.get("APP_PASSCODE", "").strip() or os.environ.get("ACCESS_TOKEN", "").strip() or os.environ.get("AUTH_PASSCODE", "").strip()

                if not required or passcode == required:
                    return self._send_json({
                        "success": True,
                        "token": passcode or "authenticated",
                        "message": "Passcode verified successfully",
                    })
                else:
                    return self._send_json({
                        "success": False,
                        "error": "Passcode 不正确，请重新输入",
                    }, 401)
            except Exception as e:
                return self._send_error(str(e), 400)

        # Enforce authentication on all other POST /api/ routes
        if path.startswith("/api/") and self._is_auth_required() and not self._is_authenticated():
            return self._send_json({
                "error": "Authentication required. Please provide valid passcode.",
                "auth_required": True,
            }, 401)

        # 1. API Key verification
        if path == "/api/verify_key":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                req_data = json.loads(body) if body else {}
                api_key = req_data.get("api_key") or self.headers.get("X-DashScope-Api-Key", "")
                result = asr_service.verify_api_key(api_key)
                return self._send_json(result)
            except Exception as e:
                return self._send_error(str(e), 400)

        # 2. Transcription upload & start
        elif path == "/api/transcribe":
            content_type = self.headers.get("Content-Type", "")
            
            try:
                if "multipart/form-data" in content_type:
                    self._handle_multipart_transcribe()
                else:
                    self._handle_json_transcribe()
            except Exception as e:
                logger.error(f"Transcription submission error: {e}", exc_info=True)
                return self._send_error(str(e), 500)
            return

        # 3. Direct text translation / re-transcribe
        elif path == "/api/retranscribe":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                session_id = data.get("session_id")
                session = history_manager.get(session_id)
                if not session:
                    return self._send_error("Session not found", 404)

                audio_path = session.get("audio_path")
                if not audio_path or not os.path.exists(audio_path):
                    return self._send_error("Original audio file not found on disk", 404)

                model = data.get("model", session.get("model", "qwen-audio-3.0-asr-flash-filetrans"))
                api_key = data.get("api_key") or self.headers.get("X-DashScope-Api-Key")
                language_hints = data.get("language_hints")
                diarization_enabled = bool(data.get("diarization_enabled", False))
                speaker_count = data.get("speaker_count")
                prompt = data.get("prompt")

                # Submit new task
                submit_res = asr_service.submit_transcription(
                    file_path=audio_path,
                    model=model,
                    api_key=api_key,
                    language_hints=language_hints,
                    diarization_enabled=diarization_enabled,
                    speaker_count=speaker_count,
                    prompt=prompt,
                )

                session.update({
                    "task_id": submit_res["task_id"],
                    "status": "PROCESSING",
                    "model": model,
                })
                history_manager.add(session_id, session)

                return self._send_json({
                    "session_id": session_id,
                    "task_id": submit_res["task_id"],
                    "status": "PROCESSING",
                })
            except Exception as e:
                return self._send_error(str(e), 500)

        return self._send_error("Endpoint not found", 404)

    def do_DELETE(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path.startswith("/api/") and self._is_auth_required() and not self._is_authenticated():
            return self._send_json({
                "error": "Authentication required. Please provide valid passcode.",
                "auth_required": True,
            }, 401)

        if path.startswith("/api/history/"):
            session_id = path[len("/api/history/"):]
            if history_manager.delete(session_id):
                return self._send_json({"success": True, "message": "Session deleted"})
            return self._send_error("Session not found", 404)

        return self._send_error("Endpoint not found", 404)

    # ---------------- Helper Methods ----------------

    def _handle_multipart_transcribe(self):
        """Parse multipart form-data for audio upload."""
        content_length = int(self.headers.get("Content-Length", 0))
        content_type = self.headers.get("Content-Type", "")
        raw_body = self.rfile.read(content_length)

        # Parse multipart body with email BytesParser
        fake_header = f"Content-Type: {content_type}\r\n\r\n".encode("utf-8")
        msg = BytesParser(policy=policy.default).parsebytes(fake_header + raw_body)

        file_bytes = None
        filename = "recording.wav"
        fields = {}

        if msg.is_multipart():
            for part in msg.iter_parts():
                name = part.get_param("name", header="content-disposition")
                part_filename = part.get_filename()
                if part_filename or name == "file":
                    file_bytes = part.get_payload(decode=True)
                    if part_filename:
                        filename = part_filename
                elif name:
                    fields[name] = part.get_payload(decode=True).decode("utf-8", errors="replace")

        if not file_bytes:
            return self._send_error("No audio file provided in upload request", 400)

        # Generate clean session ID
        session_id = f"asr_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
        ext = os.path.splitext(filename)[1] or ".wav"
        saved_filename = f"{session_id}{ext}"
        saved_filepath = UPLOADS_DIR / saved_filename

        # Write uploaded file to disk
        with open(saved_filepath, "wb") as f:
            f.write(file_bytes)

        # Parse options
        model = fields.get("model") or "qwen-audio-3.0-asr-flash-filetrans"
        api_key = fields.get("api_key") or self.headers.get("X-DashScope-Api-Key")
        lang_str = fields.get("language_hints")
        language_hints = [l.strip() for l in lang_str.split(",") if l.strip()] if lang_str else None
        diarization_enabled = str(fields.get("diarization_enabled", "false")).lower() in ["true", "1", "yes"]
        speaker_count = fields.get("speaker_count")
        speaker_count = int(speaker_count) if speaker_count and str(speaker_count).isdigit() else None
        disfluency_removal = str(fields.get("disfluency_removal_enabled", "false")).lower() in ["true", "1", "yes"]
        timestamp_alignment = str(fields.get("timestamp_alignment_enabled", "false")).lower() in ["true", "1", "yes"]
        prompt = fields.get("prompt")

        audio_url = f"/api/audio/{saved_filename}"

        # Submit transcription to DashScope
        try:
            submit_res = asr_service.submit_transcription(
                file_path=str(saved_filepath),
                model=model,
                api_key=api_key,
                language_hints=language_hints,
                diarization_enabled=diarization_enabled,
                speaker_count=speaker_count,
                disfluency_removal_enabled=disfluency_removal,
                timestamp_alignment_enabled=timestamp_alignment,
                prompt=prompt,
            )
        except Exception as e:
            # Clean up uploaded file on immediate error
            if saved_filepath.exists():
                try:
                    os.remove(saved_filepath)
                except Exception:
                    pass
            raise e

        task_id = submit_res.get("task_id")
        provider = submit_res.get("provider", "dashscope")
        task_status = submit_res.get("task_status", "PROCESSING")
        direct_result = submit_res.get("direct_result")

        # Save initial session in history
        session_data = {
            "session_id": session_id,
            "task_id": task_id,
            "filename": filename,
            "saved_filename": saved_filename,
            "audio_path": str(saved_filepath),
            "audio_url": audio_url,
            "model": model,
            "provider": provider,
            "created_at": time.time(),
            "status": task_status,
            "full_text": direct_result.get("full_text", "") if direct_result else "",
            "sentences": direct_result.get("sentences", []) if direct_result else [],
            "duration_ms": direct_result.get("duration_ms", 0) if direct_result else 0,
            "duration_str": direct_result.get("duration_str", "") if direct_result else "",
            "details": direct_result.get("details", {}) if direct_result else {},
        }
        history_manager.add(session_id, session_data)

        resp_payload = {
            "session_id": session_id,
            "task_id": task_id,
            "audio_url": audio_url,
            "status": task_status,
            "model": model,
            "provider": provider,
        }
        if direct_result:
            resp_payload.update(direct_result)

        return self._send_json(resp_payload)

    def _handle_json_transcribe(self):
        """Handle base64 or file path in JSON body."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        data = json.loads(body)

        file_path = data.get("file_path")
        if not file_path or not os.path.exists(file_path):
            return self._send_error("Valid file_path is required for JSON transcribe", 400)

        filename = os.path.basename(file_path)
        session_id = f"asr_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
        ext = os.path.splitext(filename)[1] or ".wav"
        saved_filename = f"{session_id}{ext}"
        saved_filepath = UPLOADS_DIR / saved_filename
        shutil.copy2(file_path, saved_filepath)

        model = data.get("model", "qwen/qwen3-asr-flash-2026-02-10")
        api_key = data.get("api_key") or self.headers.get("X-DashScope-Api-Key") or self.headers.get("X-OpenRouter-Api-Key")
        language_hints = data.get("language_hints")
        diarization_enabled = bool(data.get("diarization_enabled", False))
        speaker_count = data.get("speaker_count")
        disfluency_removal = bool(data.get("disfluency_removal_enabled", False))
        timestamp_alignment = bool(data.get("timestamp_alignment_enabled", False))
        prompt = data.get("prompt")

        submit_res = asr_service.submit_transcription(
            file_path=str(saved_filepath),
            model=model,
            api_key=api_key,
            language_hints=language_hints,
            diarization_enabled=diarization_enabled,
            speaker_count=speaker_count,
            disfluency_removal_enabled=disfluency_removal,
            timestamp_alignment_enabled=timestamp_alignment,
            prompt=prompt,
        )

        task_id = submit_res.get("task_id")
        provider = submit_res.get("provider", "dashscope")
        task_status = submit_res.get("task_status", "PROCESSING")
        direct_result = submit_res.get("direct_result")
        audio_url = f"/api/audio/{saved_filename}"

        session_data = {
            "session_id": session_id,
            "task_id": task_id,
            "filename": filename,
            "saved_filename": saved_filename,
            "audio_path": str(saved_filepath),
            "audio_url": audio_url,
            "model": model,
            "provider": provider,
            "created_at": time.time(),
            "status": task_status,
            "full_text": direct_result.get("full_text", "") if direct_result else "",
            "sentences": direct_result.get("sentences", []) if direct_result else [],
            "duration_ms": direct_result.get("duration_ms", 0) if direct_result else 0,
            "duration_str": direct_result.get("duration_str", "") if direct_result else "",
            "details": direct_result.get("details", {}) if direct_result else {},
        }
        history_manager.add(session_id, session_data)

        resp_payload = {
            "session_id": session_id,
            "task_id": task_id,
            "audio_url": audio_url,
            "status": task_status,
            "model": model,
            "provider": provider,
        }
        if direct_result:
            resp_payload.update(direct_result)

        return self._send_json(resp_payload)

    def _stream_audio_file(self, file_path: str):
        """Stream audio file with HTTP Range support for audio player seeking."""
        file_size = os.path.getsize(file_path)
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type or not mime_type.startswith("audio"):
            ext = os.path.splitext(file_path)[1].lower()
            mime_map = {
                ".wav": "audio/wav",
                ".mp3": "audio/mpeg",
                ".m4a": "audio/mp4",
                ".aac": "audio/aac",
                ".ogg": "audio/ogg",
                ".oga": "audio/ogg",
                ".opus": "audio/opus",
                ".webm": "audio/webm",
                ".flac": "audio/flac",
                ".amr": "audio/amr",
                ".wma": "audio/x-ms-wma",
                ".mp4": "video/mp4",
                ".mov": "video/quicktime",
                ".mkv": "video/x-matroska",
            }
            mime_type = mime_map.get(ext, "application/octet-stream")

        range_header = self.headers.get("Range")
        if range_header:
            range_match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if range_match:
                start = int(range_match.group(1))
                end = int(range_match.group(2)) if range_match.group(2) else file_size - 1
                end = min(end, file_size - 1)
                chunk_length = end - start + 1

                self.send_response(206)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(chunk_length))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                with open(file_path, "rb") as f:
                    f.seek(start)
                    bytes_left = chunk_length
                    while bytes_left > 0:
                        read_size = min(64 * 1024, bytes_left)
                        data = f.read(read_size)
                        if not data:
                            break
                        self.wfile.write(data)
                        bytes_left -= len(data)
                return

        # Full file response
        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(file_path, "rb") as f:
            shutil.copyfileobj(f, self.wfile)

    def _serve_static_file(self, file_path: Path, mime_type: str):
        """Serve frontend static asset."""
        if not file_path.exists():
            self.send_error(404, "File not found")
            return

        with open(file_path, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", f"{mime_type}; charset=utf-8" if "text" in mime_type or "javascript" in mime_type or "json" in mime_type else mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(content)

    def _send_download(self, data: bytes, filename: str, content_type: str):
        """Send file download with Content-Disposition."""
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        # URL encode filename for UTF-8 safety
        safe_ascii_name = re.sub(r"[^\w\.-]", "_", filename)
        encoded_name = urllib.parse.quote(filename)
        self.send_header("Content-Disposition", f"attachment; filename=\"{safe_ascii_name}\"; filename*=UTF-8''{encoded_name}")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)


def start_server(host: str = "127.0.0.1", port: int = 8765) -> HTTPServer:
    """Start the ASR application server."""
    server_address = (host, port)
    server = ThreadingHTTPServer(server_address, ASRRequestHandler)
    logger.info(f"🎙️ Qwen-Audio ASR Web Server running at http://{host}:{port}/")
    return server


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    host = os.environ.get("HOST", "127.0.0.1")
    server = start_server(host=host, port=port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down server...")
        server.server_close()
