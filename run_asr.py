#!/usr/bin/env python3
"""Launcher for the Qwen-Audio ASR Web Application.

Usage:
    python3 run_asr.py [--port 8765] [--host 127.0.0.1] [--no-browser] [--api-key YOUR_KEY]
"""

import argparse
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(BASE_DIR))

try:
    from asr_app.server import start_server
except ImportError as e:
    print(f"❌ Failed to import ASR server: {e}", file=sys.stderr)
    print("Please make sure required dependencies are installed: pip install dashscope requests", file=sys.stderr)
    sys.exit(1)


def find_free_port(start_port: int = 8765, max_attempts: int = 20) -> int:
    """Find an available TCP port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port


def main():
    default_port = int(os.environ.get("PORT", 8765))
    default_host = os.environ.get("HOST", "127.0.0.1")

    parser = argparse.ArgumentParser(description="Start the Qwen3 ASR Flash Web Application.")
    parser.add_argument("--port", type=int, default=default_port, help=f"Port to listen on (default: {default_port})")
    parser.add_argument("--host", type=str, default=default_host, help=f"Host address to bind to (default: {default_host})")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open web browser")
    parser.add_argument("--passcode", type=str, default=None, help="Set access passcode/token for login protection")
    parser.add_argument("--api-key", type=str, default=None, help="Set OpenRouter or DashScope API Key for the session")
    parser.add_argument("--openrouter-key", type=str, default=None, help="Set OpenRouter API Key")
    parser.add_argument("--dashscope-key", type=str, default=None, help="Set DashScope API Key")
    args = parser.parse_args()

    if args.passcode:
        os.environ["APP_PASSCODE"] = args.passcode.strip()
    if args.openrouter_key:
        os.environ["OPENROUTER_API_KEY"] = args.openrouter_key.strip()
    if args.dashscope_key:
        os.environ["DASHSCOPE_API_KEY"] = args.dashscope_key.strip()
    if args.api_key:
        if args.api_key.startswith("sk-or-"):
            os.environ["OPENROUTER_API_KEY"] = args.api_key.strip()
        else:
            os.environ["DASHSCOPE_API_KEY"] = args.api_key.strip()

    # In cloud environments (e.g. Render, Heroku) use the exact provided port
    if "PORT" in os.environ:
        port = args.port
    else:
        port = find_free_port(args.port)

    host = args.host
    url = f"http://{host}:{port}/"

    print("=" * 70)
    print("🎙️  Qwen3 ASR Flash 语音识别与高精转写系统 (OpenRouter & DashScope)")
    print("=" * 70)
    print(f"🌟 推荐模型: qwen/qwen3-asr-flash-2026-02-10 (OpenRouter)")
    print(f"🔗 本地服务访问地址: {url}")
    if os.environ.get("OPENROUTER_API_KEY"):
        print("🔑 检测到环境变量 OPENROUTER_API_KEY")
    if os.environ.get("DASHSCOPE_API_KEY"):
        print("🔑 检测到环境变量 DASHSCOPE_API_KEY")
    if os.environ.get("APP_PASSCODE") or os.environ.get("ACCESS_TOKEN"):
        print("🔒 访问保护已启用 (APP_PASSCODE / ACCESS_TOKEN 已配置)")
    if not os.environ.get("OPENROUTER_API_KEY") and not os.environ.get("DASHSCOPE_API_KEY"):
        print("💡 提示: 可直接在 Web 界面右上角或设置面板中配置 API Key")
    print("=" * 70)

    # Launch browser after a slight delay
    if not args.no_browser:
        def open_browser():
            time.sleep(0.8)
            webbrowser.open(url)
        threading.Thread(target=open_browser, daemon=True).start()

    server = start_server(host=host, port=port)
    try:
        print("按 Ctrl+C 停止服务...\n")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 正在停止 ASR Web 服务...")
        server.server_close()
        print("✅ 服务已安全关闭。")


if __name__ == "__main__":
    main()
