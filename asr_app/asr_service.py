"""ASR Service Module supporting OpenRouter (qwen/qwen3-asr-flash-2026-02-10)
and Alibaba Cloud DashScope (qwen-audio-3.0-asr-flash-filetrans).
"""

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests
import dashscope
from dashscope.audio.asr import Transcription

logger = logging.getLogger(__name__)

# Available preconfigured models strictly filtered for Audio / ASR transcription
AVAILABLE_MODELS = [
    # --- Alibaba Cloud DashScope Verified ASR Models ---
    {
        "id": "qwen-audio-3.0-asr-flash-filetrans",
        "name": "Qwen-Audio 3.0 Flash 录音转写 [DashScope 官方推荐]",
        "provider": "dashscope",
        "category": "阿里云百炼 / 离线长音频转写",
        "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
        "description": "阿里云百炼官方 3.0 Flash 录音文件转写模型，支持说话人分离、逐词时间戳、方言识别，支持至 12 小时。",
        "recommended": True,
        "is_filetrans": True,
    },
    {
        "id": "sensevoice-v1",
        "name": "SenseVoice-v1 [DashScope]",
        "provider": "dashscope",
        "category": "阿里云百炼 / 多语种与富文本识别",
        "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
        "description": "极速多语种与富文本语音识别，支持情感与声音事件检测。",
        "recommended": False,
        "is_filetrans": True,
    },
    {
        "id": "paraformer-v2",
        "name": "Paraformer-v2 [DashScope]",
        "provider": "dashscope",
        "category": "阿里云百炼 / 通用语音识别",
        "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
        "description": "通义实验室自研高精度非流式语音识别模型。",
        "recommended": False,
        "is_filetrans": True,
    },
    {
        "id": "paraformer-8k-v2",
        "name": "Paraformer 8k v2 (电话客服) [DashScope]",
        "provider": "dashscope",
        "category": "阿里云百炼 / 电话客服",
        "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
        "description": "专为 8kHz 电话录音与客服质检优化的识别模型。",
        "recommended": False,
        "is_filetrans": True,
    },

    # --- OpenRouter Verified Audio-Capable Multimodal Models ---
    {
        "id": "google/gemini-3.7-flash",
        "name": "Gemini 3.7 Flash [OpenRouter 推荐]",
        "provider": "openrouter",
        "category": "OpenRouter 语音多模态",
        "url": "https://openrouter.ai/google/gemini-3.7-flash",
        "description": "Google 顶级极速多模态模型，原生支持长音频直接输入与高精度语音转写。",
        "recommended": True,
        "is_filetrans": False,
    },
    {
        "id": "google/gemini-3.5-flash",
        "name": "Gemini 3.5 Flash [OpenRouter]",
        "provider": "openrouter",
        "category": "OpenRouter 语音多模态",
        "url": "https://openrouter.ai/google/gemini-3.5-flash",
        "description": "高性价比原生音频转写大模型。",
        "recommended": False,
        "is_filetrans": False,
    },
    {
        "id": "xiaomi/mimo-v2.5",
        "name": "Xiaomi MiMo v2.5 [OpenRouter 中文多模态]",
        "provider": "openrouter",
        "category": "OpenRouter 中文语音多模态",
        "url": "https://openrouter.ai/xiaomi/mimo-v2.5",
        "description": "小米官方多模态原生中文音频识别与理解模型。",
        "recommended": False,
        "is_filetrans": False,
    },
    {
        "id": "openai/gpt-audio-mini",
        "name": "GPT Audio Mini [OpenRouter]",
        "provider": "openrouter",
        "category": "OpenRouter 中文语音多模态",
        "url": "https://openrouter.ai/openai/gpt-audio-mini",
        "description": "OpenAI 官方原生音频多模态识别轻量模型。",
        "recommended": False,
        "is_filetrans": False,
    },
]


def format_timestamp(ms: int, format_type: str = "srt") -> str:
    """Format milliseconds into human-readable timestamp without floating point rounding errors."""
    ms = max(0, int(ms))
    milliseconds = ms % 1000
    total_seconds = ms // 1000
    seconds = total_seconds % 60
    total_minutes = total_seconds // 60
    minutes = total_minutes % 60
    hours = total_minutes // 60

    if format_type == "srt":
        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"
    elif format_type == "display":
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"
    elif format_type == "short":
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"{minutes:02d}:{seconds:02d}"
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


DEFAULT_DASHSCOPE_BASE_URL = "https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/api/v1"


class ASRService:
    def __init__(
        self,
        default_dashscope_key: Optional[str] = None,
        default_openrouter_key: Optional[str] = None,
        default_dashscope_base_url: Optional[str] = None,
    ):
        self.default_dashscope_key = default_dashscope_key or os.environ.get("DASHSCOPE_API_KEY", "")
        self.default_openrouter_key = default_openrouter_key or os.environ.get("OPENROUTER_API_KEY", "")
        self.default_dashscope_base_url = (
            default_dashscope_base_url
            or os.environ.get("DASHSCOPE_BASE_URL", "")
            or os.environ.get("DASHSCOPE_HTTP_BASE_URL", "")
            or DEFAULT_DASHSCOPE_BASE_URL
        ).strip()

    def normalize_dashscope_url(self, url: Optional[str]) -> str:
        """Normalize DashScope / Model Studio base URL for REST & Transcription API."""
        if not url or not url.strip():
            return (
                os.environ.get("DASHSCOPE_BASE_URL", "").strip()
                or self.default_dashscope_base_url
                or DEFAULT_DASHSCOPE_BASE_URL
            )
        raw = url.strip()
        if not raw.startswith("http://") and not raw.startswith("https://"):
            raw = f"https://{raw}"
        raw = raw.rstrip("/")
        # If user pasted OpenAI compatible-mode URL: https://ws-xxx/compatible-mode/v1 -> convert to /api/v1 for DashScope SDK
        if raw.endswith("/compatible-mode/v1"):
            raw = raw[:-len("/compatible-mode/v1")] + "/api/v1"
        elif not raw.endswith("/api/v1"):
            raw = f"{raw}/api/v1"
        return raw

    def get_models(self) -> List[Dict[str, Any]]:
        """Return available models."""
        return AVAILABLE_MODELS

    def fetch_all_voice_models(
        self,
        openrouter_key: Optional[str] = None,
        dashscope_key: Optional[str] = None,
        dashscope_base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch all available voice/audio models from OpenRouter and DashScope, including deprecation notices."""
        openrouter_models: List[Dict[str, Any]] = []
        dashscope_models: List[Dict[str, Any]] = []
        deprecations: List[Dict[str, Any]] = []

        # 1. Fetch OpenRouter Voice & Multimodal Models
        try:
            or_headers = {"User-Agent": "Wu-Translation-ASR/1.0"}
            eff_or_key = (openrouter_key or self.default_openrouter_key or "").strip()
            if eff_or_key and eff_or_key.startswith("sk-or-"):
                or_headers["Authorization"] = f"Bearer {eff_or_key}"
            resp = requests.get("https://openrouter.ai/api/v1/models", headers=or_headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                raw_models = data.get("data", [])
                for m in raw_models:
                    mid = m.get("id", "")
                    mid_lower = mid.lower()
                    mname = m.get("name", mid)
                    desc = m.get("description", "")
                    desc_lower = desc.lower()
                    modality = m.get("architecture", {}).get("modality", "")
                    inputs = modality.split("->")[0] if "->" in modality else modality

                    # STRICT AUDIO INPUT FILTER: Must explicitly support audio input
                    is_audio_input = "audio" in inputs.lower()
                    if not is_audio_input:
                        continue

                    # STRICT CHINESE / DIALECT CAPABILITY FILTER:
                    # Filter out models with no Chinese capability (such as muse-spark, inkling, voxtral, auto-beta)
                    # and filter out batch endpoints
                    if ":batch" in mid:
                        continue

                    has_chinese_capability = any(vendor in mid.lower() for vendor in [
                        "google/gemini",
                        "openai/gpt-audio",
                        "xiaomi/mimo",
                    ])
                    if not has_chinese_capability:
                        continue

                    exp_date = m.get("expiration_date")
                    status_field = m.get("status")
                    is_dep = bool(
                        exp_date
                        or status_field == "deprecated"
                        or any(w in desc_lower or w in mname.lower() for w in ["deprecat", "discontinue", "retired", "shut down", "eol"])
                    )
                    dep_notice = ""
                    if exp_date:
                        dep_notice = f"预计下线日期: {exp_date}"
                    elif is_dep:
                        dep_notice = "已废弃 / 建议迁移至新版"

                    model_entry = {
                        "id": mid,
                        "name": f"{mname} [中文多模态转写]",
                        "provider": "openrouter",
                        "category": "OpenRouter 中文语音多模态",
                        "modality": modality,
                        "context_length": m.get("context_length"),
                        "pricing": m.get("pricing"),
                        "description": desc[:180] + ("..." if len(desc) > 180 else ""),
                        "url": f"https://openrouter.ai/{mid}",
                        "recommended": "gemini-3.7-flash" in mid or "gemini-3.5-flash" in mid,
                        "is_deprecated": is_dep,
                        "deprecation_notice": dep_notice,
                    }
                    openrouter_models.append(model_entry)
                    if is_dep:
                        deprecations.append({
                            "id": mid,
                            "provider": "openrouter",
                            "name": mname,
                            "notice": dep_notice,
                        })
        except Exception as e:
            logger.warning(f"Failed fetching OpenRouter models: {e}")

        # 2. Fetch / Assemble Alibaba DashScope Models
        known_ds = [
            {
                "id": "qwen-audio-3.0-asr-flash-filetrans",
                "name": "Qwen-Audio 3.0 Flash 录音转写 [DashScope 官方推荐]",
                "provider": "dashscope",
                "category": "阿里云百炼 / 离线长音频转写",
                "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
                "description": "阿里云百炼官方 3.0 Flash 录音文件转写模型，支持说话人分离、逐词时间戳、方言识别，支持至 12 小时。",
                "recommended": True,
                "is_filetrans": True,
                "is_deprecated": False,
                "deprecation_notice": "",
            },
            {
                "id": "sensevoice-v1",
                "name": "SenseVoice-v1 [DashScope]",
                "provider": "dashscope",
                "category": "阿里云百炼 / 多语种与富文本识别",
                "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
                "description": "极速多语种与富文本语音识别，支持情感与声音事件检测。",
                "recommended": False,
                "is_filetrans": True,
                "is_deprecated": False,
                "deprecation_notice": "",
            },
            {
                "id": "paraformer-v2",
                "name": "Paraformer-v2 [DashScope]",
                "provider": "dashscope",
                "category": "阿里云百炼 / 通用语音识别",
                "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
                "description": "通义实验室自研高精度非流式语音识别模型。",
                "recommended": False,
                "is_filetrans": True,
                "is_deprecated": False,
                "deprecation_notice": "",
            },
            {
                "id": "paraformer-8k-v2",
                "name": "Paraformer 8k v2 (电话客服) [DashScope]",
                "provider": "dashscope",
                "category": "阿里云百炼 / 电话客服",
                "url": "https://help.aliyun.com/zh/model-studio/asr-model/#asr-decide02",
                "description": "专为 8kHz 电话录音与客服质检优化的识别模型。",
                "recommended": False,
                "is_filetrans": True,
                "is_deprecated": False,
                "deprecation_notice": "",
            },
            {
                "id": "paraformer-8k-v1",
                "name": "Paraformer 8k v1 [旧版下线]",
                "provider": "dashscope",
                "category": "阿里云百炼 / 已下线模型",
                "url": "https://help.aliyun.com/zh/model-studio/asr-model/",
                "description": "旧版 8k 客服模型，官方已停止维护升级。",
                "recommended": False,
                "is_filetrans": True,
                "is_deprecated": True,
                "deprecation_notice": "已下线 / 建议迁移至 paraformer-8k-v2",
            },
            {
                "id": "paraformer-v1",
                "name": "Paraformer-v1 [旧版下线]",
                "provider": "dashscope",
                "category": "阿里云百炼 / 已下线模型",
                "url": "https://help.aliyun.com/zh/model-studio/asr-model/",
                "description": "一代 Paraformer 模型，已被 v2 替代。",
                "recommended": False,
                "is_filetrans": True,
                "is_deprecated": True,
                "deprecation_notice": "已下线 / 建议迁移至 paraformer-v2",
            },
        ]
        dashscope_models.extend(known_ds)
        for km in known_ds:
            if km.get("is_deprecated"):
                deprecations.append({
                    "id": km["id"],
                    "provider": "dashscope",
                    "name": km["name"],
                    "notice": km["deprecation_notice"],
                })

        # Try dynamically querying DashScope workspace endpoint for additional filetrans models
        effective_ds_key = (dashscope_key or self.default_dashscope_key or "").strip()
        effective_ds_base = self.normalize_dashscope_url(dashscope_base_url or self.default_dashscope_base_url)
        if effective_ds_key and len(effective_ds_key) > 8:
            try:
                ds_compat_url = effective_ds_base.replace("/api/v1", "/compatible-mode/v1") + "/models"
                resp = requests.get(ds_compat_url, headers={"Authorization": f"Bearer {effective_ds_key}"}, timeout=8)
                if resp.status_code == 200:
                    ds_data = resp.json()
                    workspace_models = ds_data.get("data", [])
                    existing_ds_ids = {m["id"] for m in dashscope_models}
                    for wm in workspace_models:
                        w_id = wm.get("id", "")
                        w_id_lower = w_id.lower()
                        # Strictly check: Must be an offline filetrans model (exclude all realtime, omni, tts, livetranslate models)
                        is_non_filetrans = any(k in w_id_lower for k in [
                            "realtime", "omni", "livetranslate", "tts", "vc", "vd", "cosyvoice", "sambert", "s2s", "stream"
                        ])
                        is_filetrans_asr = "filetrans" in w_id_lower or w_id_lower in ["sensevoice-v1", "paraformer-v2", "paraformer-8k-v2"]
                        if is_filetrans_asr and not is_non_filetrans and w_id not in existing_ds_ids:
                            dashscope_models.append({
                                "id": w_id,
                                "name": f"{w_id} [DashScope 录音转写]",
                                "provider": "dashscope",
                                "category": "阿里云百炼 / 专属工作区模型",
                                "url": "https://help.aliyun.com/zh/model-studio/asr-model/",
                                "description": "阿里云百炼工作区在线可用离线录音转写模型。",
                                "recommended": False,
                                "is_filetrans": True,
                                "is_deprecated": False,
                                "deprecation_notice": "",
                            })
                            existing_ds_ids.add(w_id)
            except Exception as e:
                logger.debug(f"Dynamic workspace model fetch note: {e}")

        # Combine
        all_models = openrouter_models + dashscope_models
        return {
            "total_models": len(all_models),
            "models": all_models,
            "openrouter": {
                "count": len(openrouter_models),
                "models": openrouter_models,
            },
            "dashscope": {
                "count": len(dashscope_models),
                "models": dashscope_models,
            },
            "all_models": all_models,
            "deprecations": deprecations,
            "deprecation_count": len(deprecations),
        }

    def fetch_openrouter_qwen_models(self) -> List[Dict[str, Any]]:
        """Legacy helper for backward compatibility."""
        result = self.fetch_all_voice_models()
        return result.get("all_models", AVAILABLE_MODELS)

    def detect_provider(self, model: str, api_key: Optional[str] = None) -> str:
        """Detect whether to route to OpenRouter or DashScope."""
        model_lower = (model or "").lower().strip()
        
        # 1. DashScope native models
        dashscope_identifiers = [
            "qwen-audio-3.0-asr-flash-filetrans",
            "qwen3-asr-flash-filetrans",
            "qwen-audio-asr",
            "sensevoice-v1",
            "paraformer-v2",
            "paraformer-8k-v2",
            "paraformer",
            "sensevoice",
        ]
        for ds_id in dashscope_identifiers:
            if model_lower == ds_id or model_lower.startswith(ds_id):
                return "dashscope"

        # 2. OpenRouter models
        if (
            model_lower.startswith("qwen/")
            or "/" in model_lower
            or "openrouter" in model_lower
        ):
            return "openrouter"

        if api_key and (api_key.startswith("sk-or-") or api_key.startswith("sk-or-v1-")):
            return "openrouter"
        return "dashscope"

    def get_api_key(self, provided_key: Optional[str] = None, provider: str = "dashscope") -> str:
        if provided_key and provided_key.strip() and provided_key != "configured_in_env" and "..." not in provided_key:
            k = provided_key.strip()
            # Mismatch detection: If user passed an OpenRouter key for DashScope model
            if provider == "dashscope" and (k.startswith("sk-or-") or k.startswith("sk-or-v1-")):
                env_key = (os.environ.get("DASHSCOPE_API_KEY", "") or self.default_dashscope_key or "").strip()
                if env_key:
                    return env_key
                raise ValueError(
                    "检测到当前选择的是阿里云百炼模型 (DashScope)，但传入了 OpenRouter API Key。\n"
                    "请点击右上角【设置】->【阿里云百炼】，填入以 sk- 开头的 DashScope API Key，或切换为 OpenRouter 模型。"
                )
            # Mismatch detection: If user passed DashScope key for OpenRouter model
            elif provider == "openrouter" and not (k.startswith("sk-or-") or k.startswith("sk-or-v1-")):
                env_key = (os.environ.get("OPENROUTER_API_KEY", "") or self.default_openrouter_key or "").strip()
                if env_key:
                    return env_key
                raise ValueError(
                    "检测到当前选择的是 OpenRouter 模型，但传入的不是 OpenRouter Key (sk-or-v1-...)。\n"
                    "请点击右上角【设置】->【OpenRouter】，填入有效的 OpenRouter API Key。"
                )
            return k

        if provider == "openrouter":
            return (os.environ.get("OPENROUTER_API_KEY", "") or self.default_openrouter_key or "").strip()
        return (os.environ.get("DASHSCOPE_API_KEY", "") or self.default_dashscope_key or "").strip()

    def verify_api_key(
        self,
        api_key: str,
        provider: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Test API key validity for OpenRouter or DashScope with optional custom base URL."""
        key = (api_key or "").strip()
        if not key:
            return {"valid": False, "message": "API key cannot be empty."}

        if not provider:
            provider = "openrouter" if key.startswith("sk-or-") else "dashscope"

        if provider == "openrouter":
            try:
                resp = requests.get(
                    "https://openrouter.ai/api/v1/auth/key",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    label = data.get("data", {}).get("label") or "Active Key"
                    return {"valid": True, "provider": "openrouter", "message": f"OpenRouter API Key 验证成功 ({label})"}
                elif resp.status_code == 401:
                    return {"valid": False, "provider": "openrouter", "message": "OpenRouter 认证失败，请检查 API Key"}
                else:
                    return {"valid": False, "provider": "openrouter", "message": f"OpenRouter 响应错误: {resp.status_code}"}
            except Exception as e:
                logger.warning(f"OpenRouter key verification network exception: {e}")
                if key.startswith("sk-or-") and len(key) > 20:
                    return {"valid": True, "provider": "openrouter", "message": "OpenRouter Key 格式有效 (网络跳过)"}
                return {"valid": False, "provider": "openrouter", "message": f"验证异常: {str(e)}"}
        else:
            try:
                if len(key) < 10:
                    return {"valid": False, "provider": "dashscope", "message": "DashScope API Key 格式无效"}
                
                effective_base = self.normalize_dashscope_url(base_url or self.default_dashscope_base_url)
                resp = requests.get(
                    f"{effective_base}/tasks",
                    headers={"Authorization": f"Bearer {key}"},
                    params={"page_no": 1, "page_size": 1},
                    timeout=10,
                )
                if resp.status_code in [200, 400, 404]:
                    region_tag = "自定义端点" if base_url else "DashScope"
                    return {"valid": True, "provider": "dashscope", "message": f"{region_tag} API Key 验证成功"}
                elif resp.status_code in [401, 403]:
                    return {"valid": False, "provider": "dashscope", "message": "DashScope 认证失败，API Key 或端点地址无效"}
                else:
                    return {"valid": True, "provider": "dashscope", "message": "API Key 格式已识别"}
            except Exception as e:
                logger.warning(f"DashScope key verification exception: {e}")
                if key.startswith("sk-") and len(key) >= 20:
                    return {"valid": True, "provider": "dashscope", "message": "DashScope Key 格式有效"}
                return {"valid": False, "provider": "dashscope", "message": f"验证异常: {str(e)}"}

    def submit_transcription(
        self,
        file_path: str,
        model: str = "qwen-audio-3.0-asr-flash-filetrans",
        api_key: Optional[str] = None,
        language_hints: Optional[List[str]] = None,
        diarization_enabled: bool = True,
        speaker_count: Optional[int] = None,
        disfluency_removal_enabled: bool = True,
        timestamp_alignment_enabled: bool = True,
        prompt: Optional[str] = None,
        phrase_id: Optional[str] = None,
        base_url: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Submit transcription to either OpenRouter or DashScope."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        if language_hints is None:
            language_hints = ["zh", "wuu"]

        provider = self.detect_provider(model, api_key)
        key = self.get_api_key(api_key, provider=provider)

        if not key:
            provider_name = "OpenRouter" if provider == "openrouter" else "DashScope"
            env_var = "OPENROUTER_API_KEY" if provider == "openrouter" else "DASHSCOPE_API_KEY"
            raise ValueError(f"{provider_name} API Key is required. Please set {env_var} or enter it in settings.")

        abs_path = os.path.abspath(file_path)

        if provider == "openrouter":
            return self._transcribe_openrouter(
                file_path=abs_path,
                model=model,
                api_key=key,
                language_hints=language_hints,
                prompt=prompt,
            )
        else:
            return self._transcribe_dashscope(
                file_path=abs_path,
                model=model,
                api_key=key,
                language_hints=language_hints,
                diarization_enabled=diarization_enabled,
                speaker_count=speaker_count,
                disfluency_removal_enabled=disfluency_removal_enabled,
                timestamp_alignment_enabled=timestamp_alignment_enabled,
                prompt=prompt,
                phrase_id=phrase_id,
                base_url=base_url,
                **kwargs,
            )

    def normalize_audio(self, file_path: str, target_sr: int = 16000) -> str:
        """
        Normalize audio/video file (.m4a, .aac, .mp3, .mov, .mp4, .opus, .flac, etc.)
        to standard 16kHz 16-bit Mono Linear PCM WAV for maximum ASR compatibility.
        Adheres to Alibaba Cloud Model Studio & OpenRouter ASR specs.
        """
        if not os.path.exists(file_path):
            return file_path

        # If already a 16kHz mono WAV, keep it
        ext = Path(file_path).suffix.lower()
        out_wav = f"{file_path}_16k.wav"
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 100:
            return out_wav

        # 1. Try ffmpeg (Linux/Docker/Windows)
        ffmpeg_bin = shutil.which("ffmpeg")
        if ffmpeg_bin:
            try:
                cmd = [
                    ffmpeg_bin, "-y",
                    "-i", file_path,
                    "-ar", str(target_sr),
                    "-ac", "1",
                    "-c:a", "pcm_s16le",
                    out_wav,
                ]
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                if res.returncode == 0 and os.path.exists(out_wav) and os.path.getsize(out_wav) > 100:
                    logger.info(f"Normalized audio: {file_path} -> {out_wav} (16kHz Mono WAV via ffmpeg)")
                    return out_wav
            except Exception as e:
                logger.warning(f"ffmpeg conversion failed: {e}")

        # 2. Try afconvert (macOS native built-in)
        afconvert_bin = shutil.which("afconvert") or ("/usr/bin/afconvert" if os.path.exists("/usr/bin/afconvert") else None)
        if afconvert_bin:
            try:
                cmd = [
                    afconvert_bin,
                    file_path,
                    "-o", out_wav,
                    "-f", "WAVE",
                    "-d", f"LEI16@{target_sr}",
                    "-c", "1",
                ]
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                if res.returncode == 0 and os.path.exists(out_wav) and os.path.getsize(out_wav) > 100:
                    logger.info(f"Normalized audio: {file_path} -> {out_wav} (16kHz Mono WAV via afconvert)")
                    return out_wav
            except Exception as e:
                logger.warning(f"afconvert conversion failed: {e}")

        return file_path

    # ---------------- OpenRouter Provider ----------------

    def _transcribe_openrouter(
        self,
        file_path: str,
        model: str = "qwen/qwen3-asr-flash-2026-02-10",
        api_key: str = "",
        language_hints: Optional[List[str]] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transcribe audio file via OpenRouter API (qwen/qwen3-asr-flash-2026-02-10)."""
        logger.info(f"Submitting OpenRouter transcription for {file_path} with model {model}")

        # Normalize audio (e.g. .m4a, .aac, .mp4 -> 16kHz mono WAV) for optimal ASR accuracy and compatibility
        target_audio_path = self.normalize_audio(file_path)
        file_duration_ms = self._get_audio_duration_ms(target_audio_path) or self._get_audio_duration_ms(file_path)

        with open(target_audio_path, "rb") as f:
            audio_bytes = f.read()

        ext = Path(target_audio_path).suffix.lower().lstrip(".") or "wav"
        format_map = {
            "wav": "wav", "mp3": "mp3", "m4a": "wav", "aac": "wav", "flac": "flac",
            "ogg": "ogg", "oga": "ogg", "opus": "opus", "webm": "webm", "mp4": "wav",
            "mov": "wav", "mkv": "wav", "amr": "wav", "wma": "wav", "alac": "wav", "caf": "wav",
        }
        audio_format = format_map.get(ext, "wav")
        base64_audio = base64.b64encode(audio_bytes).decode("utf-8")

        # Resolve API key (supports server env fallback when opened from new browser)
        api_key = self.get_api_key(api_key, provider="openrouter")
        if not api_key:
            raise RuntimeError(
                "未检测到有效的 OpenRouter API Key。\n"
                "请在右上角【设置】->【OpenRouter】中填入 API Key，或在服务器环境变量中配置 OPENROUTER_API_KEY。"
            )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8765",
            "X-Title": "Wu-Translation-ASR Platform",
        }

        transcription_res = None
        task_id = f"or_{int(time.time() * 1000)}_{os.urandom(4).hex()}"

        # Strategy 1: OpenRouter /api/v1/audio/transcriptions (JSON input_audio format)
        payload: Dict[str, Any] = {
            "model": model,
            "input_audio": {
                "data": base64_audio,
                "format": "wav" if target_audio_path.endswith(".wav") else audio_format,
            },
        }
        if prompt and prompt.strip():
            payload["prompt"] = prompt.strip()
        if language_hints and len(language_hints) > 0 and language_hints[0]:
            payload["language"] = language_hints[0]

        last_error_msg = ""
        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/audio/transcriptions",
                headers=headers,
                json=payload,
                timeout=180,
            )
            if resp.status_code == 200:
                transcription_res = resp.json()
            else:
                logger.warning(f"OpenRouter audio/transcriptions (JSON) returned {resp.status_code}: {resp.text}")
                last_error_msg = self._extract_error_message(resp)

                # Strategy 2: Standard multipart/form-data upload
                try:
                    with open(target_audio_path, "rb") as f_in:
                        mime_type = "audio/wav" if target_audio_path.endswith(".wav") else f"audio/{audio_format}"
                        files = {
                            "file": (os.path.basename(target_audio_path), f_in, mime_type),
                        }
                        data = {
                            "model": model,
                        }
                        if prompt and prompt.strip():
                            data["prompt"] = prompt.strip()
                        if language_hints and len(language_hints) > 0 and language_hints[0]:
                            data["language"] = language_hints[0]

                        multipart_headers = {
                            "Authorization": f"Bearer {api_key}",
                            "HTTP-Referer": "http://localhost:8765",
                            "X-Title": "Qwen-Audio ASR Platform",
                        }
                        mp_resp = requests.post(
                            "https://openrouter.ai/api/v1/audio/transcriptions",
                            headers=multipart_headers,
                            files=files,
                            data=data,
                            timeout=180,
                        )
                        if mp_resp.status_code == 200:
                            transcription_res = mp_resp.json()
                        else:
                            logger.warning(f"OpenRouter multipart transcriptions returned {mp_resp.status_code}: {mp_resp.text}")
                            last_error_msg = self._extract_error_message(mp_resp)
                except Exception as mp_err:
                    logger.warning(f"Multipart strategy exception: {mp_err}")

                # Strategy 3: /api/v1/chat/completions fallback for general multimodal models (skip for dedicated ASR models)
                is_dedicated_asr = any(k in model.lower() for k in ("asr", "whisper", "transcription"))
                if not transcription_res and not is_dedicated_asr:
                    chat_payload = {
                        "model": model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": (
                                            "Please accurately transcribe the following audio speech into text with original Chinese and punctuation. Output only the verbatim transcript text."
                                            + (f"\nVocabulary context: {prompt}" if prompt else "")
                                        ),
                                    },
                                    {
                                        "type": "input_audio",
                                        "input_audio": {
                                            "data": base64_audio,
                                            "format": "wav" if target_audio_path.endswith(".wav") else audio_format,
                                        },
                                    },
                                ],
                            }
                        ],
                    }
                    chat_resp = requests.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers=headers,
                        json=chat_payload,
                        timeout=180,
                    )
                    if chat_resp.status_code == 200:
                        chat_json = chat_resp.json()
                        content = chat_json.get("choices", [{}])[0].get("message", {}).get("content", "")
                        transcription_res = {"text": content}
                    else:
                        logger.warning(f"OpenRouter chat/completions fallback returned {chat_resp.status_code}: {chat_resp.text}")
                        last_error_msg = self._extract_error_message(chat_resp)

                if not transcription_res:
                    raise RuntimeError(f"OpenRouter API request failed: {last_error_msg or f'HTTP {resp.status_code}'}")

        except Exception as e:
            if "OpenRouter API request failed" in str(e):
                raise e
            logger.error(f"OpenRouter transcription request failed: {e}", exc_info=True)
            raise RuntimeError(f"OpenRouter ASR error: {str(e)}")

        # Parse normalized output
        parsed = self.parse_openrouter_result(transcription_res, model=model, fallback_duration_ms=file_duration_ms)
        parsed["task_id"] = task_id
        parsed["provider"] = "openrouter"
        parsed["model"] = model
        parsed["file_path"] = file_path

        # Cache direct result
        self._openrouter_cache[task_id] = parsed

        return {
            "task_id": task_id,
            "task_status": "SUCCEEDED",
            "provider": "openrouter",
            "model": model,
            "file_path": file_path,
            "direct_result": parsed,
        }

    _openrouter_cache: Dict[str, Any] = {}

    def _extract_error_message(self, resp: requests.Response) -> str:
        """Extract user-friendly error message from API response."""
        try:
            data = resp.json()
            if isinstance(data, dict):
                err = data.get("error")
                if isinstance(err, dict):
                    msg = err.get("message") or err.get("raw") or str(err)
                    if msg:
                        return msg
                elif isinstance(err, str):
                    return err
                if "message" in data:
                    return data["message"]
        except Exception:
            pass
        return resp.text[:300] if resp.text else f"HTTP {resp.status_code}"

    def _get_audio_duration_ms(self, file_path: str) -> int:
        """Attempt to read duration from audio file without heavy dependencies."""
        try:
            ext = Path(file_path).suffix.lower()
            if ext == ".wav":
                import wave
                with wave.open(file_path, "rb") as wf:
                    frames = wf.getnframes()
                    rate = wf.getframerate()
                    if rate > 0:
                        return int((frames / float(rate)) * 1000)
        except Exception:
            pass
        return 0

    def parse_openrouter_result(
        self,
        raw_data: Dict[str, Any],
        model: str = "",
        fallback_duration_ms: int = 0,
    ) -> Dict[str, Any]:
        """Parse OpenRouter transcription response into normalized sentence structure."""
        full_text = raw_data.get("text", "").strip()
        segments = raw_data.get("segments", [])
        sentences_out: List[Dict[str, Any]] = []
        total_duration_ms = int(raw_data.get("duration", 0) * 1000) or fallback_duration_ms

        if segments and isinstance(segments, list):
            for idx, seg in enumerate(segments):
                start_ms = int(float(seg.get("start", 0)) * 1000)
                end_ms = int(float(seg.get("end", 0)) * 1000)
                total_duration_ms = max(total_duration_ms, end_ms)
                seg_text = seg.get("text", "").strip()
                if seg_text:
                    sentences_out.append({
                        "sentence_id": idx,
                        "channel_id": 0,
                        "speaker_id": None,
                        "speaker_label": "",
                        "begin_time": start_ms,
                        "end_time": end_ms,
                        "begin_time_str": format_timestamp(start_ms, "display"),
                        "end_time_str": format_timestamp(end_ms, "display"),
                        "text": seg_text,
                        "words": seg.get("words", []),
                    })

        # Fallback if no segments provided: split full text by sentence terminators
        if not sentences_out and full_text:
            # Split by punctuation
            raw_sents = re.split(r'([。！？\n!?;]+)', full_text)
            chunks = []
            for i in range(0, len(raw_sents), 2):
                piece = raw_sents[i]
                punct = raw_sents[i+1] if i + 1 < len(raw_sents) else ""
                comb = (piece + punct).strip()
                if comb:
                    chunks.append(comb)

            if not chunks:
                chunks = [full_text]

            chunk_dur = max(2000, total_duration_ms // len(chunks)) if total_duration_ms else 3000
            for idx, c in enumerate(chunks):
                begin = idx * chunk_dur
                end = (idx + 1) * chunk_dur
                total_duration_ms = max(total_duration_ms, end)
                sentences_out.append({
                    "sentence_id": idx,
                    "channel_id": 0,
                    "speaker_id": None,
                    "speaker_label": "",
                    "begin_time": begin,
                    "end_time": end,
                    "begin_time_str": format_timestamp(begin, "display"),
                    "end_time_str": format_timestamp(end, "display"),
                    "text": c,
                    "words": [],
                })

        return {
            "status": "SUCCEEDED",
            "full_text": full_text,
            "sentences": sentences_out,
            "duration_ms": total_duration_ms,
            "duration_str": format_timestamp(total_duration_ms, "short"),
            "details": raw_data,
        }

    # ---------------- DashScope Provider ----------------

    def _transcribe_dashscope(
        self,
        file_path: str,
        model: str = "qwen-audio-3.0-asr-flash-filetrans",
        api_key: str = "",
        language_hints: Optional[List[str]] = None,
        diarization_enabled: bool = False,
        speaker_count: Optional[int] = None,
        disfluency_removal_enabled: bool = False,
        timestamp_alignment_enabled: bool = False,
        prompt: Optional[str] = None,
        phrase_id: Optional[str] = None,
        base_url: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Submit an asynchronous transcription task to DashScope."""
        extra_kwargs: Dict[str, Any] = {}

        if language_hints and isinstance(language_hints, list) and len(language_hints) > 0:
            extra_kwargs["language_hints"] = language_hints

        if diarization_enabled:
            extra_kwargs["diarization_enabled"] = True
            if speaker_count and int(speaker_count) > 0:
                extra_kwargs["speaker_count"] = int(speaker_count)

        if disfluency_removal_enabled:
            extra_kwargs["disfluency_removal_enabled"] = True

        if timestamp_alignment_enabled:
            extra_kwargs["timestamp_alignment_enabled"] = True

        if prompt and prompt.strip():
            extra_kwargs["prompt"] = prompt.strip()

        if phrase_id and phrase_id.strip():
            extra_kwargs["phrase_id"] = phrase_id.strip()

        for k, v in kwargs.items():
            if v is not None:
                extra_kwargs[k] = v

        # Normalize model aliases to official DashScope IDs
        if model in ["qwen3-asr-flash-filetrans", "qwen3-asr-flash", "qwen3-audio-flash"]:
            model = "qwen-audio-3.0-asr-flash-filetrans"

        # Validate if model is a TTS (Text-to-Speech) or non-ASR model
        m_lower = model.lower()
        if any(k in m_lower for k in ["tts", "vc", "vd", "cosyvoice", "sambert"]):
            raise RuntimeError(
                f"【{model}】是语音合成 (TTS, 文本生成语音) 模型，不支持录音转写 (ASR, 语音转文字)。\n"
                "录音转写请在【设置】->【阿里云百炼】中选择官方转写模型: 【qwen-audio-3.0-asr-flash-filetrans】或【sensevoice-v1】。"
            )
        if "realtime" in m_lower or "s2s" in m_lower:
            raise RuntimeError(
                f"【{model}】是实时全双工流式对齐模型，不支持离线长录音转写。\n"
                "录音转写请在【设置】->【阿里云百炼】中选择官方转写模型: 【qwen-audio-3.0-asr-flash-filetrans】。"
            )

        # Resolve API key (supports server env fallback when opened from new browser)
        api_key = self.get_api_key(api_key, provider="dashscope")
        if not api_key:
            raise RuntimeError(
                "未检测到有效的 阿里云百炼 API Key。\n"
                "请在右上角【设置】->【阿里云百炼】中填入 API Key，或在服务器环境变量中配置 DASHSCOPE_API_KEY。"
            )

        effective_base_url = self.normalize_dashscope_url(base_url or self.default_dashscope_base_url)
        dashscope.base_http_api_url = effective_base_url
        dashscope.api_key = api_key

        # 1. Normalize audio format for maximum accuracy (.m4a, .mp3 -> 16kHz mono WAV)
        target_path = self.normalize_audio(file_path)

        # 2. If it is a local file, upload to DashScope temporary inference OSS
        if not (target_path.startswith("http://") or target_path.startswith("https://") or target_path.startswith("oss://")):
            from dashscope.utils.oss_utils import OssUtils
            logger.info(f"Uploading local audio {target_path} to DashScope inference OSS (model: {model})...")
            try:
                oss_url, _ = OssUtils.upload(model=model, file_path=target_path, api_key=api_key)
                file_urls = [oss_url]
                headers = extra_kwargs.get("headers", {})
                headers["X-DashScope-OssResourceResolve"] = "enable"
                extra_kwargs["headers"] = headers
                logger.info(f"Local audio uploaded successfully: {oss_url}")
            except Exception as e:
                logger.error(f"Failed to upload local audio to DashScope OSS: {e}", exc_info=True)
                raise RuntimeError(f"音频上传至 DashScope OSS 失败: {str(e)}")
        else:
            file_urls = [target_path]

        logger.info(f"Submitting DashScope transcription for file: {file_urls[0]} with model: {model} (Endpoint: {effective_base_url})")

        try:
            response = Transcription.async_call(
                model=model,
                file_urls=file_urls,
                api_key=api_key,
                **extra_kwargs,
            )
        except Exception as e:
            logger.error(f"Error calling Transcription.async_call: {e}", exc_info=True)
            raise RuntimeError(f"DashScope API call failed: {str(e)}")

        if response.status_code != 200:
            err_code = getattr(response, "code", "") or ""
            err_text = getattr(response, "message", "") or ""
            if "InvalidApiKey" in err_code or "Invalid API-key" in err_text:
                endpoint_hint = f" (当前请求端点: {effective_base_url})" if base_url else ""
                err_msg = (
                    f"阿里云百炼 API 认证失败: Invalid API-key provided.{endpoint_hint}\n"
                    "排查建议:\n"
                    "1. 请在【设置】->【阿里云百炼】中确认 DashScope API Key 是否正确输入。\n"
                    "2. 若您的 Key 属于阿里云百炼新加坡区或专属工作区，请在设置中配置对应的 API Base URL (例如: https://ws-uu5x3qpaxvgc7cut.ap-southeast-1.maas.aliyuncs.com/api/v1)。"
                )
            elif "does not support asynchronous calls" in err_text or "AccessDenied" in err_code:
                err_msg = (
                    f"模型【{model}】不支持百炼离线长录音转写接口 (HTTP 403: current user api does not support asynchronous calls)。\n"
                    "排查建议:\n"
                    "1. 该模型可能属于实时流式、全双工或语音合成 (TTS) 模型，不能通过离线录音转写接口调用。\n"
                    "2. 录音文件转写请在【设置】->【阿里云百炼】中选择官方推荐的离线转写模型: 【qwen-audio-3.0-asr-flash-filetrans】或【sensevoice-v1】。"
                )
            else:
                err_msg = f"DashScope 任务提交失败 (HTTP {response.status_code}): {err_code} - {err_text}"
            logger.error(err_msg)
            raise RuntimeError(err_msg)

        task_id = response.output.get("task_id") if isinstance(response.output, dict) else getattr(response.output, "task_id", None)
        task_status = response.output.get("task_status", "PENDING") if isinstance(response.output, dict) else getattr(response.output, "task_status", "PENDING")

        return {
            "task_id": task_id,
            "task_status": task_status,
            "provider": "dashscope",
            "model": model,
            "file_path": file_path,
            "submitted_at": time.time(),
        }

    def fetch_task_status(
        self,
        task_id: str,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch current status and result of a transcription task."""
        # Check OpenRouter direct cache first
        if task_id.startswith("or_") and task_id in self._openrouter_cache:
            return self._openrouter_cache[task_id]

        key = self.get_api_key(api_key, provider="dashscope")
        if not key:
            raise ValueError("DashScope API Key is required.")

        effective_base_url = self.normalize_dashscope_url(base_url or self.default_dashscope_base_url)
        dashscope.base_http_api_url = effective_base_url
        dashscope.api_key = key
        logger.info(f"Fetching DashScope task {task_id} status from endpoint: {effective_base_url}")

        try:
            response = Transcription.fetch(task=task_id, api_key=key)
        except Exception as e:
            logger.error(f"Error fetching task {task_id}: {e}", exc_info=True)
            raise RuntimeError(f"Error checking task status: {str(e)}")

        if response.status_code != 200:
            err_code = getattr(response, "code", "") or ""
            err_text = getattr(response, "message", "") or ""
            if "InvalidApiKey" in err_code or "Invalid API-key" in err_text:
                err_msg = (
                    f"阿里云百炼 API 认证失败: Invalid API-key provided. (请求端点: {effective_base_url})\n"
                    "请确认 DashScope API Key 与设置中的 API Base URL 是否来自同一个百炼工作区/区域。"
                )
            else:
                err_msg = f"DashScope 任务查询失败 (HTTP {response.status_code}): {err_code} - {err_text}"
            logger.error(f"Task fetch failed for {task_id}: {err_msg}")
            return {
                "task_id": task_id,
                "status": "FAILED",
                "code": err_code,
                "message": err_msg,
                "error_message": err_msg,
            }

        raw_output = response.output if isinstance(response.output, dict) else (response.output.__dict__ if hasattr(response.output, "__dict__") else {})
        task_status = raw_output.get("task_status", "UNKNOWN")

        result_payload: Dict[str, Any] = {
            "task_id": task_id,
            "status": task_status,
            "raw_output": raw_output,
        }

        if task_status == "SUCCEEDED":
            parsed = self.parse_transcription_result(raw_output)
            result_payload.update(parsed)
        elif task_status in ["FAILED", "CANCELED"]:
            result_payload["error_message"] = raw_output.get("message") or response.message or "Transcription task failed."

        return result_payload

    def parse_transcription_result(self, raw_output: Dict[str, Any]) -> Dict[str, Any]:
        """Download result JSON if transcription_url is present, and normalize transcripts."""
        results = raw_output.get("results", [])
        transcription_data = None
        transcription_url = raw_output.get("transcription_url")

        if results and len(results) > 0:
            first_res = results[0]
            if isinstance(first_res, dict):
                if not transcription_url:
                    transcription_url = first_res.get("transcription_url")
                if first_res.get("subtask_status") == "FAILED":
                    sub_code = first_res.get("code") or ""
                    sub_msg = first_res.get("message") or raw_output.get("message") or "Subtask transcription failed"
                    if "ASR_RESPONSE_HAVE_NO_WORDS" in sub_code or "ASR_RESPONSE_HAVE_NO_WORDS" in sub_msg:
                        sub_msg = "音频中未检测到清晰人声或语音内容 (ASR_RESPONSE_HAVE_NO_WORDS)"
                    return {
                        "status": "FAILED",
                        "error_message": sub_msg,
                    }

        if transcription_url:
            try:
                logger.info(f"Fetching transcription result from URL: {transcription_url}")
                resp = requests.get(transcription_url, timeout=30)
                if resp.status_code == 200:
                    transcription_data = resp.json()
            except Exception as e:
                logger.error(f"Failed downloading transcription JSON: {e}")

        if not transcription_data:
            transcription_data = raw_output.get("transcription") or raw_output

        transcripts = transcription_data.get("transcripts", [])
        sentences_out: List[Dict[str, Any]] = []
        full_text_parts: List[str] = []
        total_duration_ms = 0

        if transcripts and isinstance(transcripts, list):
            for channel_idx, channel in enumerate(transcripts):
                channel_text = channel.get("text", "")
                if channel_text:
                    full_text_parts.append(channel_text)

                channel_sentences = channel.get("sentences", [])
                for s_idx, s in enumerate(channel_sentences):
                    begin_time = int(s.get("begin_time", 0))
                    end_time = int(s.get("end_time", 0))
                    total_duration_ms = max(total_duration_ms, end_time)
                    speaker_id = s.get("speaker_id")
                    speaker_label = f"Speaker {speaker_id}" if speaker_id is not None else f"Channel {channel_idx + 1}" if len(transcripts) > 1 else ""

                    sentence_obj = {
                        "sentence_id": len(sentences_out),
                        "channel_id": channel_idx,
                        "speaker_id": speaker_id,
                        "speaker_label": speaker_label,
                        "begin_time": begin_time,
                        "end_time": end_time,
                        "begin_time_str": format_timestamp(begin_time, "display"),
                        "end_time_str": format_timestamp(end_time, "display"),
                        "text": s.get("text", "").strip(),
                        "words": s.get("words", []),
                    }
                    sentences_out.append(sentence_obj)

        elif "sentences" in transcription_data:
            for s_idx, s in enumerate(transcription_data.get("sentences", [])):
                begin_time = int(s.get("begin_time", 0))
                end_time = int(s.get("end_time", 0))
                total_duration_ms = max(total_duration_ms, end_time)
                speaker_id = s.get("speaker_id")
                speaker_label = f"Speaker {speaker_id}" if speaker_id is not None else ""

                sentence_obj = {
                    "sentence_id": s_idx,
                    "channel_id": 0,
                    "speaker_id": speaker_id,
                    "speaker_label": speaker_label,
                    "begin_time": begin_time,
                    "end_time": end_time,
                    "begin_time_str": format_timestamp(begin_time, "display"),
                    "end_time_str": format_timestamp(end_time, "display"),
                    "text": s.get("text", "").strip(),
                    "words": s.get("words", []),
                }
                sentences_out.append(sentence_obj)
            full_text_parts.append(transcription_data.get("text", ""))

        elif "text" in transcription_data:
            full_text_parts.append(transcription_data.get("text", ""))

        full_text = "\n\n".join([p for p in full_text_parts if p.strip()])
        if not full_text and sentences_out:
            full_text = "".join([s["text"] for s in sentences_out])

        return {
            "status": "SUCCEEDED",
            "full_text": full_text,
            "sentences": sentences_out,
            "duration_ms": total_duration_ms,
            "duration_str": format_timestamp(total_duration_ms, "short"),
            "transcription_url": transcription_url,
            "details": transcription_data,
        }

    @staticmethod
    def generate_srt(sentences: List[Dict[str, Any]]) -> str:
        """Generate SubRip Subtitle (.srt) format."""
        srt_lines = []
        for idx, s in enumerate(sentences, start=1):
            begin_str = format_timestamp(s.get("begin_time", 0), "srt")
            end_str = format_timestamp(s.get("end_time", 0), "srt")
            text = s.get("text", "")
            speaker = s.get("speaker_label")
            if speaker:
                text = f"[{speaker}] {text}"
            srt_lines.append(f"{idx}\n{begin_str} --> {end_str}\n{text}\n")
        return "\n".join(srt_lines)

    @staticmethod
    def generate_markdown(
        full_text: str,
        sentences: List[Dict[str, Any]],
        model_name: str = "",
        duration_str: str = "",
    ) -> str:
        """Generate formatted Markdown export."""
        lines = [
            "# Audio Transcription",
            "",
            f"- **Model**: `{model_name}`" if model_name else "",
            f"- **Duration**: {duration_str}" if duration_str else "",
            f"- **Date**: {time.strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "## Full Transcript",
            "",
            full_text if full_text else "_No text content_",
            "",
            "---",
            "",
            "## Timestamped Dialogue",
            "",
        ]

        lines = [l for l in lines if l != ""]

        for s in sentences:
            time_tag = f"`[{s.get('begin_time_str')} -> {s.get('end_time_str')}]`"
            speaker = f"**{s.get('speaker_label')}**: " if s.get("speaker_label") else ""
            lines.append(f"- {time_tag} {speaker}{s.get('text', '')}")

        return "\n".join(lines)


# Singleton instance
asr_service = ASRService()
