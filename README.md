# UrbanGuard AI (城市设施智能巡航系统)

**UrbanGuard AI** 是一个基于 YOLO v10 的智能城市基础设施巡航预警系统。它能够实时检测城市设施（如井盖）的安全隐患，并监控各类工程车辆，提供可视化的预警信息，旨在提升城市管理的智能化水平。

## 🌟 核心功能

- **实时智能检测**：利用高性能的 YOLO 模型进行毫秒级目标检测，准确识别各类目标。
- **多源视频支持**：
  - 📷 **本地摄像头**：支持调用设备摄像头进行实时监控。
  - 📂 **视频文件上传**：支持 MP4, WebM 等常见格式的视频文件检测。
  - 🌐 **网络流媒体**：支持 RTMP/RTSP/HTTP 等流媒体协议，可接入监控摄像头画面。
- **实时可视化**：通过 WebSocket 实现前后端低延迟数据传输，并在前端 Canvas 上实时绘制检测框和置信度。
- **交互式仪表盘**：基于 Vue.js 和 Bootstrap 构建的现代化响应式界面，操作便捷。
- **统计分析**：实时统计检测到的各类目标数量。

## 🔍 支持检测类别

系统目前支持识别以下 **17 种** 类别，涵盖井盖状态及各类工程车辆：

### 井盖与设施

- **井盖状态**：`井盖破损`、`井圈问题`、`井盖完好`、`井盖缺失`、`井盖未盖`
- **其他设施**：`法兰`、`管道`

### 工程车辆

- `挖掘机`、`卡车`、`压路机`、`吊车`、`塔吊`
- `装载机`、`搅拌车`、`挖掘装载机`、`推土机`、`平地机`

## 🛠️ 技术栈

### 后端 (Backend)

- **Python 3.10**
- **Conda**: 环境管理工具。
- **FastAPI**: 高性能的异步 Web 框架，用于构建 API 和 WebSocket 服务。
- **Ultralytics YOLO**: 强大的目标检测模型框架。
- **PyTorch (CUDA 11.8)**: 深度学习计算框架。
- **OpenCV**: 用于图像处理和视频流捕获。
- **Uvicorn**: ASGI 服务器。

### 前端 (Frontend)

- **HTML5 / CSS3 / JavaScript (ES6+)**
- **Vue.js 3**: 渐进式 JavaScript 框架 (使用 ESM 构建)。
- **Element Plus**: 基于 Vue 3 的组件库。
- **Bootstrap 5**: 响应式布局框架。
- **Canvas API**: 用于高性能的视频帧渲染和标注绘制。

## 🚀 安装与运行指南

### 环境准备

- **操作系统**：Windows / Linux / macOS
- **环境管理**：Anaconda 或 Miniconda
- **显卡驱动**：支持 CUDA 11.8 的 NVIDIA 显卡驱动

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd SmartWaterPatrolSystem
```

### 2. 环境配置 (Conda)

本项目建议使用 Conda 进行环境管理。请按照以下步骤创建并激活环境：

#### 方式一：手动创建（推荐，确保 CUDA 版本正确）

```bash
# 1. 创建 Python 3.10 环境
conda create -n water_patrol python=3.10
conda activate water_patrol

# 2. 安装 PyTorch (CUDA 11.8 版本)
# 注意：必须指定 index-url 以获取支持 CUDA 11.8 的版本
pip install torch==2.1.1 torchvision==0.16.1 --index-url https://download.pytorch.org/whl/cu118

# 3. 安装其他依赖
cd backend
pip install -r requirements.txt
```

#### 方式二：使用 environment.yml

如果使用 `environment.yml` 创建环境，请在创建后确认 PyTorch 版本是否匹配 CUDA 11.8。

```bash
conda env create -f environment.yml
conda activate water_patrol

# 如果发现 PyTorch 版本不对或不支持 CUDA，请执行以下命令重新安装 PyTorch：
pip uninstall torch torchvision
pip install torch==2.1.1 torchvision==0.16.1 --index-url https://download.pytorch.org/whl/cu118
```

_确保 `backend` 目录下已放置训练好的 YOLO 模型文件 `best.pt`。_

### 3. 启动服务

#### 步骤一：启动后端 API

```bash
cd backend
python app.py
```

后端服务启动后，将监听 `0.0.0.0:8001`。

#### 步骤二：启动前端服务

打开一个新的终端窗口，激活相同的 Conda 环境，进入前端目录并启动服务：

```bash
conda activate water_patrol
cd frontend
python run_server.py
```

### 4. 访问系统

打开浏览器（推荐 Chrome 或 Edge）访问：
[http://localhost:8088](http://localhost:8088)

## 📁 目录结构概览

```
SmartWaterPatrolSystem/
├── backend/                # 后端核心代码
│   ├── app.py              # FastAPI 应用入口与业务逻辑
│   ├── best.pt             # YOLO 预训练模型权重
│   ├── requirements.txt    # Python 依赖清单
│   └── inspect_model.py    # 模型检查工具
├── frontend/               # 前端界面代码
│   ├── index.html          # 单页应用入口
│   ├── css/                # 样式表
│   ├── js/                 # JavaScript 源码
│   │   ├── modules/        # 功能模块 (控制器、绘图逻辑等)
│   │   └── app.js          # Vue 应用主逻辑
│   ├── run_server.py       # 前端服务器启动脚本
│   └── server.py           # 简单的 Python 前端服务器脚本
├── environment.yml         # Conda 环境配置文件
└── README.md               # 项目说明文档
```

## ⚠️ 注意事项

1.  **CUDA 版本**：请确保本地安装了 CUDA Toolkit 11.8 或兼容的驱动版本，否则模型将运行在 CPU 模式下，速度会受到影响。
2.  **浏览器权限**：使用摄像头功能时，请允许浏览器访问摄像头的权限。
3.  **流媒体延迟**：RTSP/RTMP 流的延迟取决于网络状况和流媒体服务器配置，建议在局域网环境下测试。
4.  **性能优化**：如果检测帧率较低，可以尝试在后端调整图像处理的分辨率或更换更轻量级的 YOLO 模型版本。

---

_UrbanGuard AI - Protecting City Infrastructure with Intelligence._
