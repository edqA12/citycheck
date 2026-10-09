import http.server
import mimetypes
import os
import sys

PORT = 8088
DIRECTORY = "."

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
        # 确保 extensions_map 中包含正确的 MIME 类型
        self.extensions_map.update({
            '.js': 'application/javascript',
            '.mjs': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
        })

    def guess_type(self, path):
        # 强制指定 .js 和 .mjs 的 MIME 类型
        if path.endswith(".js") or path.endswith(".mjs"):
            return "application/javascript"
        if path.endswith(".css"):
            return "text/css"
        if path.endswith(".json"):
            return "application/json"
        # 其他文件使用默认的 guess_type
        return super().guess_type(path)

    # 允许跨域请求（可选，方便调试）
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        # 禁止缓存，防止浏览器缓存旧的 MIME 类型
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

if __name__ == "__main__":
    # 切换到脚本所在目录
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # 确保 mimetypes 库也能识别（双重保障）
    if sys.platform == 'win32':
        # Windows 注册表有时会覆盖 MIME 类型，这里尝试强制添加
        mimetypes.add_type('application/javascript', '.js')
        mimetypes.add_type('application/javascript', '.mjs')
        mimetypes.add_type('text/css', '.css')

    print(f"Starting server at http://localhost:{PORT}")
    print(f"Serving directory: {os.getcwd()}")
    
    # 并行处理资源请求，避免一个等待中的连接阻塞整个页面
    with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)
