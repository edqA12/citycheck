from flask import Flask, send_from_directory, request
import os
import requests

app = Flask(__name__, static_folder='.')
BACKEND_URL = "http://localhost:8001"  # 后端API地址

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# 代理API请求到后端服务器
@app.route('/test/stream-connection', methods=['POST'])
def proxy_stream_test():
    # 将请求转发到后端
    response = requests.post(f"{BACKEND_URL}/test/stream-connection", 
                            json=request.json,
                            headers={'Content-Type': 'application/json'})
    return response.json(), response.status_code

@app.route('/<path:path>')
def serve_file(path):
    response = send_from_directory('.', path)
    if path.endswith('.js'):
        response.headers['Content-Type'] = 'application/javascript'
    return response

if __name__ == '__main__':
    print(f"启动服务器在端口 8080")
    print(f"当前工作目录: {os.getcwd()}")
    print(f"后端API地址: {BACKEND_URL}")
    app.run(host='0.0.0.0', port=8080, debug=True)