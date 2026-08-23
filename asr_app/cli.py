"""Command-line interface for Qwen-Audio ASR transcription.

Usage:
    python3 -m asr_app.cli my_recording.wav --model qwen-audio-3.0-asr-flash-filetrans --output result.srt
"""

import argparse
import os
import sys
import time
from pathlib import Path

from asr_app.asr_service import ASRService, format_timestamp


def main():
    parser = argparse.ArgumentParser(
        description="吴语翻译 (Fangyan ASR) - Transcribe audio files using OpenRouter or Alibaba Cloud DashScope ASR models."
    )
    parser.add_argument("audio_file", help="Path to local audio or video file")
    parser.add_argument(
        "--model",
        default="qwen/qwen3-asr-flash-2026-02-10",
        help="Model ID (default: qwen/qwen3-asr-flash-2026-02-10, or qwen-audio-3.0-asr-flash-filetrans)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="API Key (OpenRouter or DashScope, defaults to OPENROUTER_API_KEY or DASHSCOPE_API_KEY)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output file path (.txt, .md, .srt, or .json). If not specified, saves .srt and .md automatically.",
    )
    parser.add_argument(
        "--lang",
        default=None,
        help="Language hint, e.g. 'zh' for Chinese, 'yue' for Cantonese, 'en' for English (comma separated if multiple)",
    )
    parser.add_argument(
        "--diarization",
        action="store_true",
        help="Enable speaker diarization (who spoke when)",
    )
    parser.add_argument(
        "--speakers",
        type=int,
        default=None,
        help="Expected number of speakers (optional)",
    )
    parser.add_argument(
        "--prompt",
        default=None,
        help="Domain vocabulary context or hotwords to improve accuracy",
    )
    parser.add_argument(
        "--disfluency",
        action="store_true",
        help="Filter filler/mood words",
    )
    parser.add_argument(
        "--align",
        action="store_true",
        help="Enable timestamp-alignment calibration",
    )

    args = parser.parse_args()

    audio_path = os.path.abspath(args.audio_file)
    if not os.path.exists(audio_path):
        print(f"❌ Error: File not found at '{audio_path}'", file=sys.stderr)
        sys.exit(1)

    service = ASRService()
    provider = service.detect_provider(args.model, args.api_key)
    api_key = service.get_api_key(args.api_key, provider=provider)
    if not api_key:
        env_name = "OPENROUTER_API_KEY" if provider == "openrouter" else "DASHSCOPE_API_KEY"
        print(f"❌ Error: {provider.capitalize()} API Key is required. Set {env_name} or use --api-key.", file=sys.stderr)
        sys.exit(1)

    lang_hints = [l.strip() for l in args.lang.split(",")] if args.lang else None

    print(f"🚀 Submitting audio file: {os.path.basename(audio_path)}")
    print(f"📦 Model: {args.model}")
    if lang_hints:
        print(f"🌐 Language hints: {lang_hints}")
    if args.diarization:
        print("👥 Speaker diarization: Enabled")

    try:
        submit_res = service.submit_transcription(
            file_path=audio_path,
            model=args.model,
            api_key=api_key,
            language_hints=lang_hints,
            diarization_enabled=args.diarization,
            speaker_count=args.speakers,
            disfluency_removal_enabled=args.disfluency,
            timestamp_alignment_enabled=args.align,
            prompt=args.prompt,
        )
        task_id = submit_res["task_id"]
        print(f"⏳ Task submitted successfully! Task ID: {task_id}")
        print("🔄 Waiting for transcription results...", end="", flush=True)

        # Polling
        while True:
            time.sleep(2)
            print(".", end="", flush=True)
            res = service.fetch_task_status(task_id, api_key=api_key)
            status = res.get("status")
            if status in ["SUCCEEDED", "FAILED", "CANCELED"]:
                print()
                break

        if status != "SUCCEEDED":
            print(f"❌ Transcription failed: {res.get('error_message') or res.get('message')}", file=sys.stderr)
            sys.exit(1)

        print("✨ Transcription completed successfully!\n")
        full_text = res.get("full_text", "")
        sentences = res.get("sentences", [])
        duration_str = res.get("duration_str", "")

        print("=" * 60)
        print("TRANSCRIPT PREVIEW:")
        print("=" * 60)
        print(full_text[:500] + ("..." if len(full_text) > 500 else ""))
        print("=" * 60)
        print(f"Total Sentences: {len(sentences)} | Duration: {duration_str}\n")

        # Save files
        base_no_ext = os.path.splitext(audio_path)[0]
        if args.output:
            out_path = Path(args.output)
            out_ext = out_path.suffix.lower()
            if out_ext == ".txt":
                out_path.write_text(full_text, encoding="utf-8")
            elif out_ext == ".md":
                md_content = service.generate_markdown(full_text, sentences, model_name=args.model, duration_str=duration_str)
                out_path.write_text(md_content, encoding="utf-8")
            elif out_ext == ".srt":
                srt_content = service.generate_srt(sentences)
                out_path.write_text(srt_content, encoding="utf-8")
            elif out_ext == ".json":
                import json
                out_path.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
            else:
                out_path.write_text(full_text, encoding="utf-8")
            print(f"💾 Saved output to: {out_path.resolve()}")
        else:
            # Default save both .srt and .md
            srt_path = Path(f"{base_no_ext}.srt")
            md_path = Path(f"{base_no_ext}.md")
            srt_path.write_text(service.generate_srt(sentences), encoding="utf-8")
            md_path.write_text(service.generate_markdown(full_text, sentences, model_name=args.model, duration_str=duration_str), encoding="utf-8")
            print(f"💾 Saved Subtitles: {srt_path}")
            print(f"💾 Saved Markdown:  {md_path}")

    except Exception as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
