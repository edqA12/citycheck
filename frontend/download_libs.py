import os
import urllib.request

# 创建 lib 目录
os.makedirs("js/lib", exist_ok=True)
os.makedirs("css/lib", exist_ok=True)

urls = {
    "js/lib/vue.esm-browser.js": "https://unpkg.com/vue@3.2.31/dist/vue.esm-browser.js",
    "js/lib/element-plus.index.full.mjs": "https://unpkg.com/element-plus@2.3.14/dist/index.full.mjs",
    "css/lib/element-plus.index.css": "https://unpkg.com/element-plus@2.3.14/dist/index.css",
    "css/lib/bootstrap.min.css": "https://unpkg.com/bootstrap@5.1.3/dist/css/bootstrap.min.css",
    "js/lib/bootstrap.bundle.min.js": "https://unpkg.com/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js",
    "js/lib/chart.min.js": "https://unpkg.com/chart.js@3.7.0/dist/chart.min.js"
}

print("开始下载依赖...")
for path, url in urls.items():
    print(f"下载 {url} -> {path}")
    try:
        urllib.request.urlretrieve(url, path)
        print("成功")
    except Exception as e:
        print(f"失败: {e}")
