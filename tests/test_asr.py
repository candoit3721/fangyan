"""Unit and integration tests for the Qwen-Audio ASR application."""

import json
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

from asr_app.asr_service import ASRService, format_timestamp
from asr_app.server import ASRRequestHandler, HistoryManager, start_server


class TestASRService(unittest.TestCase):
    def setUp(self):
        self.service = ASRService()

    def test_format_timestamp(self):
        # 12345 ms = 12.345s -> 00:00:12,345 (SRT) or 00:12.345 (display)
        self.assertEqual(format_timestamp(12345, "srt"), "00:00:12,345")
        self.assertEqual(format_timestamp(12345, "display"), "00:12.345")
        self.assertEqual(format_timestamp(3665123, "srt"), "01:01:05,123")
        self.assertEqual(format_timestamp(3665123, "display"), "01:01:05")

    def test_srt_generation(self):
        sentences = [
            {
                "sentence_id": 0,
                "speaker_label": "Speaker 1",
                "begin_time": 1000,
                "end_time": 4500,
                "text": "欢迎使用 Qwen-Audio 3.0 语音识别平台。",
            },
            {
                "sentence_id": 1,
                "speaker_label": "Speaker 2",
                "begin_time": 5000,
                "end_time": 8200,
                "text": "本系统支持高精度录音转写与中文多方言识别。",
            },
        ]
        srt = self.service.generate_srt(sentences)
        self.assertIn("1\n00:00:01,000 --> 00:00:04,500\n[Speaker 1] 欢迎使用 Qwen-Audio 3.0 语音识别平台。", srt)
        self.assertIn("2\n00:00:05,000 --> 00:00:08,200\n[Speaker 2] 本系统支持高精度录音转写与中文多方言识别。", srt)

    def test_markdown_generation(self):
        full_text = "欢迎使用 Qwen-Audio 3.0 语音识别平台。本系统支持高精度录音转写。"
        sentences = [
            {
                "sentence_id": 0,
                "speaker_label": "Speaker 1",
                "begin_time_str": "00:01.000",
                "end_time_str": "00:04.500",
                "text": "欢迎使用 Qwen-Audio 3.0 语音识别平台。",
            }
        ]
        md = self.service.generate_markdown(
            full_text=full_text,
            sentences=sentences,
            model_name="qwen-audio-3.0-asr-flash-filetrans",
            duration_str="00:04",
        )
        self.assertIn("# Audio Transcription", md)
        self.assertIn("qwen-audio-3.0-asr-flash-filetrans", md)
        self.assertIn("[00:01.000 -> 00:04.500]", md)

    def test_parse_transcription_result(self):
        mock_raw_output = {
            "transcripts": [
                {
                    "channel_id": 0,
                    "text": "阿里云百炼语音大模型转写测试。",
                    "sentences": [
                        {
                            "begin_time": 200,
                            "end_time": 2500,
                            "text": "阿里云百炼语音大模型转写测试。",
                            "speaker_id": 1,
                            "words": [
                                {"text": "阿里云", "begin_time": 200, "end_time": 800},
                                {"text": "百炼", "begin_time": 800, "end_time": 1200},
                            ],
                        }
                    ],
                }
            ]
        }
        parsed = self.service.parse_transcription_result(mock_raw_output)
        self.assertEqual(parsed["status"], "SUCCEEDED")
        self.assertEqual(parsed["full_text"], "阿里云百炼语音大模型转写测试。")
        self.assertEqual(len(parsed["sentences"]), 1)
        self.assertEqual(parsed["sentences"][0]["speaker_label"], "Speaker 1")
        self.assertEqual(parsed["sentences"][0]["begin_time"], 200)
        self.assertEqual(parsed["sentences"][0]["end_time"], 2500)
        self.assertEqual(parsed["duration_ms"], 2500)

    def test_openrouter_provider_detection_and_parsing(self):
        # 1. Provider detection
        provider1 = self.service.detect_provider("qwen/qwen3-asr-flash-2026-02-10")
        self.assertEqual(provider1, "openrouter")
        provider2 = self.service.detect_provider("qwen-audio-3.0-asr-flash-filetrans")
        self.assertEqual(provider2, "dashscope")

        # 2. OpenRouter verbose_json parsing
        mock_or_result = {
            "text": "使用 OpenRouter 的 Qwen3 ASR Flash 模型进行智能转写。",
            "duration": 4.5,
            "segments": [
                {
                    "id": 0,
                    "start": 0.2,
                    "end": 2.1,
                    "text": "使用 OpenRouter 的 Qwen3 ASR Flash 模型",
                },
                {
                    "id": 1,
                    "start": 2.2,
                    "end": 4.5,
                    "text": "进行智能转写。",
                }
            ]
        }
        parsed = self.service.parse_openrouter_result(mock_or_result, model="qwen/qwen3-asr-flash-2026-02-10")
        self.assertEqual(parsed["status"], "SUCCEEDED")
        self.assertEqual(len(parsed["sentences"]), 2)
        self.assertEqual(parsed["sentences"][0]["begin_time"], 200)
        self.assertEqual(parsed["sentences"][0]["end_time"], 2100)
        self.assertEqual(parsed["sentences"][1]["begin_time"], 2200)
        self.assertEqual(parsed["sentences"][1]["end_time"], 4500)
        self.assertEqual(parsed["duration_ms"], 4500)

    def test_api_key_verification_invalid(self):
        res = self.service.verify_api_key("")
        self.assertFalse(res["valid"])
        res2 = self.service.verify_api_key("short")
        self.assertFalse(res2["valid"])

    def test_normalize_audio(self):
        import wave
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            dummy_path = f.name

        with wave.open(dummy_path, "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(44100)
            wf.writeframes(b"\x00\x00" * 44100)

        normalized = self.service.normalize_audio(dummy_path)
        self.assertTrue(os.path.exists(normalized))

        if normalized != dummy_path:
            with wave.open(normalized, "rb") as wf:
                self.assertEqual(wf.getnchannels(), 1)
                self.assertEqual(wf.getframerate(), 16000)
                self.assertEqual(wf.getsampwidth(), 2)
            os.remove(normalized)

        os.remove(dummy_path)

    def test_normalize_dashscope_url(self):
        # Default
        self.assertEqual(self.service.normalize_dashscope_url(None), "https://dashscope.aliyuncs.com/api/v1")
        self.assertEqual(self.service.normalize_dashscope_url(""), "https://dashscope.aliyuncs.com/api/v1")

        # Raw Hostname
        self.assertEqual(
            self.service.normalize_dashscope_url("ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com"),
            "https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/api/v1",
        )

        # Compatible-mode URL conversion
        self.assertEqual(
            self.service.normalize_dashscope_url("https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"),
            "https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/api/v1",
        )

        # Already full DashScope URL
        self.assertEqual(
            self.service.normalize_dashscope_url("https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/api/v1"),
            "https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/api/v1",
        )

        # International regional URL
        self.assertEqual(
            self.service.normalize_dashscope_url("https://dashscope-intl.aliyuncs.com/api/v1/"),
            "https://dashscope-intl.aliyuncs.com/api/v1",
        )


class TestServerEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 8799
        cls.server = start_server(host="127.0.0.1", port=cls.port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.3)
        cls.base_url = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.server_close()

    def test_get_index(self):
        req = urllib.request.Request(f"{self.base_url}/")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("Qwen3 ASR Flash", content)
            self.assertIn("qwen/qwen3-asr-flash-2026-02-10", content)

    def test_get_static_assets(self):
        with urllib.request.urlopen(f"{self.base_url}/styles.css") as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("text/css", resp.headers.get("Content-Type", ""))

        with urllib.request.urlopen(f"{self.base_url}/app.js") as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("javascript", resp.headers.get("Content-Type", ""))

    def test_get_config(self):
        with urllib.request.urlopen(f"{self.base_url}/api/config") as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("models", data)
            self.assertEqual(data["default_model"], "qwen/qwen3-asr-flash-2026-02-10")
            # Verify expanded OpenRouter model presence
            model_ids = [m["id"] for m in data["models"]]
            self.assertIn("qwen/qwen3-asr-flash-2026-02-10", model_ids)
            self.assertIn("qwen/qwen3.7-flash", model_ids)
            self.assertIn("qwen/qwen3.8-27b", model_ids)

    def test_refresh_models_endpoint(self):
        with urllib.request.urlopen(f"{self.base_url}/api/models/refresh") as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("models", data)
            self.assertGreaterEqual(len(data["models"]), 10)

    def test_get_history(self):
        with urllib.request.urlopen(f"{self.base_url}/api/history") as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("history", data)

    def test_verify_key_endpoint(self):
        req = urllib.request.Request(
            f"{self.base_url}/api/verify_key",
            data=json.dumps({"api_key": ""}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertFalse(data["valid"])

    def test_history_and_export_endpoints(self):
        from asr_app.server import history_manager

        test_session_id = "test_session_123"
        session_data = {
            "session_id": test_session_id,
            "filename": "meeting_notes.wav",
            "model": "qwen-audio-3.0-asr-flash-filetrans",
            "created_at": time.time(),
            "status": "SUCCEEDED",
            "full_text": "今天我们讨论了基于大模型的语音识别与转写系统。",
            "sentences": [
                {
                    "sentence_id": 0,
                    "speaker_label": "Speaker 1",
                    "begin_time": 500,
                    "end_time": 3200,
                    "begin_time_str": "00:00.500",
                    "end_time_str": "00:03.200",
                    "text": "今天我们讨论了基于大模型的语音识别与转写系统。",
                }
            ],
            "duration_str": "00:03",
        }
        history_manager.add(test_session_id, session_data)

        # Test GET /api/history/<session_id>
        with urllib.request.urlopen(f"{self.base_url}/api/history/{test_session_id}") as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["session_id"], test_session_id)
            self.assertEqual(data["full_text"], session_data["full_text"])

        # Test Export TXT
        with urllib.request.urlopen(f"{self.base_url}/api/export/{test_session_id}/txt") as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("今天我们讨论了基于大模型的语音识别与转写系统。", content)

        # Test Export MD
        with urllib.request.urlopen(f"{self.base_url}/api/export/{test_session_id}/md") as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("# Audio Transcription", content)
            self.assertIn("qwen-audio-3.0-asr-flash-filetrans", content)

        # Test Export SRT
        with urllib.request.urlopen(f"{self.base_url}/api/export/{test_session_id}/srt") as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("00:00:00,500 --> 00:00:03,200", content)

        # Test Export JSON
        with urllib.request.urlopen(f"{self.base_url}/api/export/{test_session_id}/json") as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data["session_id"], test_session_id)

        # Test DELETE /api/history/<session_id>
        req = urllib.request.Request(
            f"{self.base_url}/api/history/{test_session_id}",
            method="DELETE",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(data["success"])

        # Verify deletion
        self.assertIsNone(history_manager.get(test_session_id))

        # Test DELETE /api/history/clear
        history_manager.clear_all()
        history_manager.add("item_1", {"session_id": "item_1", "text": "test 1"})
        history_manager.add("item_2", {"session_id": "item_2", "text": "test 2"})
        self.assertEqual(len(history_manager.list_all()), 2)

        clear_req = urllib.request.Request(
            f"{self.base_url}/api/history/clear",
            method="DELETE",
        )
        with urllib.request.urlopen(clear_req) as resp:
            self.assertEqual(resp.status, 200)
            clear_data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(clear_data["success"])
            self.assertEqual(clear_data["deleted_count"], 2)

        self.assertEqual(len(history_manager.list_all()), 0)

    def test_passcode_authentication(self):
        # Set APP_PASSCODE
        secret_passcode = "supersecret123"
        os.environ["APP_PASSCODE"] = secret_passcode

        try:
            # 1. Check auth status
            with urllib.request.urlopen(f"{self.base_url}/api/auth/status") as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(data["auth_required"])
                self.assertFalse(data["authenticated"])

            # 2. Unauthenticated GET /api/config should return 401
            try:
                urllib.request.urlopen(f"{self.base_url}/api/config")
                self.fail("Expected HTTP 401 Unauthorized")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 401)
                err_data = json.loads(e.read().decode("utf-8"))
                self.assertTrue(err_data.get("auth_required"))

            # 3. Test /api/auth/login with wrong passcode
            bad_login_req = urllib.request.Request(
                f"{self.base_url}/api/auth/login",
                data=json.dumps({"passcode": "wrongcode"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(bad_login_req)
                self.fail("Expected HTTP 401 for wrong passcode")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 401)

            # 4. Test /api/auth/login with correct passcode
            good_login_req = urllib.request.Request(
                f"{self.base_url}/api/auth/login",
                data=json.dumps({"passcode": secret_passcode}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(good_login_req) as resp:
                self.assertEqual(resp.status, 200)
                login_data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(login_data["success"])

            # 5. Authenticated GET /api/config with Bearer header
            authed_req = urllib.request.Request(
                f"{self.base_url}/api/config",
                headers={"Authorization": f"Bearer {secret_passcode}"},
            )
            with urllib.request.urlopen(authed_req) as resp:
                self.assertEqual(resp.status, 200)
                config_data = json.loads(resp.read().decode("utf-8"))
                self.assertTrue(config_data["auth_required"])

            # 6. Authenticated GET with token query parameter
            with urllib.request.urlopen(f"{self.base_url}/api/config?token={secret_passcode}") as resp:
                self.assertEqual(resp.status, 200)

        finally:
            # Clean up env var
            os.environ.pop("APP_PASSCODE", None)


if __name__ == "__main__":
    unittest.main()
