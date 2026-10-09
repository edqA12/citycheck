from fastapi import FastAPI, WebSocket, UploadFile, File, HTTPException, WebSocketDisconnect, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState
from pathlib import Path
from urllib.parse import urlsplit
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from ultralytics import YOLO
import json
import asyncio
from typing import List
import uvicorn
import time
from datetime import datetime
from pydantic import BaseModel, Field, ValidationError, field_validator
from PIL import Image, ImageDraw, ImageFont

app = FastAPI(title="城市设施巡航预警与预案系统")

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 加载 YOLO 模型
model = YOLO(str(Path(__file__).resolve().with_name("best.pt")))

# 类别名称映射
CLASS_NAMES = {
    0: '井盖破损', 1: '井圈问题', 2: '井盖完好', 3: '井盖缺失', 4: '井盖未盖', 
    5: '法兰', 6: '管道', 7: '挖掘机', 8: '卡车', 9: '压路机', 10: '吊车', 
    11: '塔吊', 12: '装载机', 13: '搅拌车', 14: '挖掘装载机', 15: '推土机', 16: '平地机'
}

# 流媒体连接与读取超时，不改变检测模型或默认播放参数
STREAM_OPEN_TIMEOUT_MS = 8000
STREAM_READ_TIMEOUT_MS = 8000
STREAM_REQUEST_TIMEOUT_SECONDS = 10
MAX_STREAM_RECONNECT_ATTEMPTS = 3


def validate_stream_url(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 2048 or any(c.isspace() or ord(c) < 32 for c in value):
        raise ValueError("流媒体地址为空或格式不正确")
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if (parsed.scheme.lower() not in {"rtmp", "rtmps", "rtsp", "rtsps", "http", "https"}
                or not parsed.hostname or port == 0):
            raise ValueError("不支持的流媒体协议或缺少服务器地址")
    except ValueError as exc:
        raise ValueError("请提供有效的 RTMP、RTSP 或 HTTP(S) 地址") from exc
    return value


# HTTP 连接测试和 WebSocket 拉流使用相同的地址校验
class StreamURL(BaseModel):
    url: str
    fps: int = Field(default=15, ge=1, le=60, strict=True)

    @field_validator("url")
    @classmethod
    def check_url(cls, value: str) -> str:
        return validate_stream_url(value)


class StreamDetectionRequest(BaseModel):
    stream_url: str
    fps: int = Field(default=30, ge=1, le=60, strict=True)
    skip_frames: int = Field(default=3, ge=0, le=120, strict=True)
    image_quality: int = Field(default=60, ge=1, le=100, strict=True)
    resize_factor: float = Field(default=0.6, ge=0.1, le=1.0, strict=True, allow_inf_nan=False)

    @field_validator("stream_url")
    @classmethod
    def check_url(cls, value: str) -> str:
        return validate_stream_url(value)


def stream_validation_message(exc) -> str:
    errors = exc.errors()
    location = errors[0].get("loc", ()) if errors else ()
    field = location[-1] if location else None
    hints = {
        "url": "请填写有效的 RTMP、RTSP 或 HTTP(S) 流媒体地址",
        "stream_url": "请填写有效的 RTMP、RTSP 或 HTTP(S) 流媒体地址",
        "fps": "帧率须为 1 至 60 之间的整数",
        "skip_frames": "跳帧数须为 0 至 120 之间的整数",
        "image_quality": "图片质量须为 1 至 100 之间的整数",
        "resize_factor": "缩放比例须为 0.1 至 1 之间的数字",
    }
    return "流媒体参数错误：" + hints.get(field, "请提交包含流媒体地址的有效 JSON 对象")


@app.exception_handler(RequestValidationError)
async def handle_request_validation(request: Request, exc: RequestValidationError):
    if request.url.path == "/test/stream-connection":
        # 保留前端使用的 success/message 格式，同时返回正确的 HTTP 状态
        return JSONResponse(status_code=422, content={
            "success": False, "message": stream_validation_message(exc)
        })
    return await request_validation_exception_handler(request, exc)


def open_stream_capture(url: str):
    cap = cv2.VideoCapture()
    try:
        # OpenCV 的这两个超时参数必须在打开连接时传入
        cap.open(url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, STREAM_OPEN_TIMEOUT_MS,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, STREAM_READ_TIMEOUT_MS,
        ])
        return cap
    except Exception:
        cap.release()
        raise


def read_stream_frame(cap, discard_frames=0):
    for _ in range(discard_frames):
        if not cap.grab():
            return False, None
    return cap.read()


async def send_stream_error(websocket: WebSocket, message: str):
    if (websocket.client_state != WebSocketState.DISCONNECTED
            and websocket.application_state != WebSocketState.DISCONNECTED):
        try:
            await websocket.send_json({"error": message})
        except (WebSocketDisconnect, RuntimeError):
            pass

# 绘制中文文本函数
def draw_chinese_text(img, text, position, font_size=20, color=(0, 255, 0), thickness=2, font_obj=None):
    """使用PIL绘制支持中文的文本"""
    # 创建一个PIL图像，使用RGBA模式
    pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)
    
    # 使用传入的字体对象或尝试加载字体
    if font_obj is None:
        # 尝试多个可能的中文字体
        font = None
        font_paths = [
            "simhei.ttf",  # 黑体
            "c:/windows/fonts/simhei.ttf",  # Windows黑体
            "c:/windows/fonts/msyh.ttc",    # Windows微软雅黑
            "c:/windows/fonts/simsun.ttc",  # Windows宋体
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",  # Linux文泉驿
            "/System/Library/Fonts/PingFang.ttc"  # macOS苹方
        ]
        
        for path in font_paths:
            try:
                font = ImageFont.truetype(path, font_size)
                break
            except:
                continue
        
        # 如果没有找到任何中文字体，使用默认字体
        if font is None:
            font = ImageFont.load_default()
    else:
        # 使用传入的字体对象
        font = font_obj
    
    # 绘制文本
    draw.text(position, text, font=font, fill=color)
    
    # 转换回OpenCV格式
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

@app.get("/")
async def root():
    return {"message": "水管安全检测系统 API"}

@app.post("/detect/image")
async def detect_image(file: UploadFile = File(...)):
    # 读取上传的图片
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="上传文件为空")
    nparr = np.frombuffer(contents, np.uint8)
    try:
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except cv2.error as exc:
        raise HTTPException(status_code=400, detail="无法解码图片，请上传有效的图片文件") from exc
    if img is None:
        raise HTTPException(status_code=400, detail="无法解码图片，请上传有效的图片文件")
    
    # 运行检测
    results = model(img)
    
    # 处理检测结果
    detections = []
    for result in results:
        boxes = result.boxes
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            conf = float(box.conf[0])
            cls = int(box.cls[0])
            detections.append({
                "bbox": [float(x1), float(y1), float(x2), float(y2)],
                "confidence": conf,
                "class": cls,
                "class_name": CLASS_NAMES.get(cls, f"未知类别-{cls}")
            })
    
    return {"detections": detections}

@app.websocket("/ws/detect")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # 接收视频帧
            data = await websocket.receive_bytes()
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # 运行检测
            results = model(frame)
            
            # 处理检测结果
            detections = []
            for result in results:
                boxes = result.boxes
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0])
                    cls = int(box.cls[0])
                    detections.append({
                        "bbox": [float(x1), float(y1), float(x2), float(y2)],
                        "confidence": conf,
                        "class": cls,
                        "class_name": CLASS_NAMES.get(cls, f"未知类别-{cls}")
                    })
            
            # 发送检测结果
            await websocket.send_json({"detections": detections})
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if (websocket.client_state != WebSocketState.DISCONNECTED
                and websocket.application_state != WebSocketState.DISCONNECTED):
            await websocket.close()

@app.websocket("/ws/stream")
async def stream_detection(websocket: WebSocket):
    """从流媒体服务器拉流并进行检测"""
    await websocket.accept()
    cap = None
    
    try:
        # 验证参数后再连接，防止非法值进入除法、跳帧和图像缩放
        data = await asyncio.wait_for(
            websocket.receive_json(), timeout=STREAM_REQUEST_TIMEOUT_SECONDS
        )
        settings = StreamDetectionRequest.model_validate(data)
        stream_url = settings.stream_url
        target_fps = settings.fps
        skip_frames = settings.skip_frames
        image_quality = settings.image_quality
        resize_factor = settings.resize_factor
        
        # 置信度阈值
        confidence_threshold = 0.5
        
        # 网络连接和读取在工作线程执行，等待期间其他接口仍能响应
        cap = await run_in_threadpool(open_stream_capture, stream_url)
        if not cap.isOpened():
            await send_stream_error(websocket, "无法连接到流媒体服务器：连接超时或地址不可用")
            return
        
        # 尝试优化视频捕获缓冲设置
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)  # 设置较小的缓冲区
            
        # 获取视频信息
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if width <= 0 or height <= 0:
            await send_stream_error(websocket, "流媒体未提供有效的视频尺寸")
            return

        # 根据缩放因子计算目标尺寸，避免得到零像素尺寸
        target_width = max(1, int(width * resize_factor))
        target_height = max(1, int(height * resize_factor))
        
        # 发送连接成功消息
        await websocket.send_json({
            "status": "connected",
            "video_info": {
                "width": target_width,
                "height": target_height,
                "original_width": width,
                "original_height": height
            }
        })
        
        # 计算帧间延迟时间 - 调低延迟
        frame_delay = max(0.01, 0.8 / target_fps)  # 确保最小延迟不低于10ms，但总体缩短20%
        last_frame_time = time.time()
        frame_count = 0
        last_detections = []  # 存储上一次的检测结果，用于跳帧优化
        reconnect_attempts = 0
        
        # 预先加载模型到内存
        _ = model(np.zeros((100, 100, 3), dtype=np.uint8))
        
        # 为中文字体准备好字体对象，避免每次检测都查找
        font = None
        font_paths = [
            "c:/windows/fonts/simhei.ttf",  # Windows黑体
            "c:/windows/fonts/msyh.ttc",    # Windows微软雅黑
            "c:/windows/fonts/simsun.ttc",  # Windows宋体
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",  # Linux文泉驿
            "/System/Library/Fonts/PingFang.ttc",  # macOS苹方
            "simhei.ttf",  # 黑体
        ]
        
        for path in font_paths:
            try:
                font = ImageFont.truetype(path, 24)
                break
            except:
                continue
                
        if font is None:
            font = ImageFont.load_default()
        
        # 开始处理视频流
        while True:
            # 控制帧率 - 使用更精确的计时
            current_time = time.time()
            elapsed = current_time - last_frame_time
            if elapsed < frame_delay:
                await asyncio.sleep(0.001)  # 非阻塞短暂等待
                continue
            
            # 清除旧帧和读取新帧均使用同一连接的读取超时
            discard_frames = 2 if frame_count % 10 == 0 else 0
            ret, frame = await run_in_threadpool(read_stream_frame, cap, discard_frames)
            if not ret or frame is None:
                reconnect_attempts += 1
                if reconnect_attempts > MAX_STREAM_RECONNECT_ATTEMPTS:
                    await send_stream_error(websocket, "连续读取失败：读取超时或流媒体已中断，请检查地址后重新连接")
                    break
                await websocket.send_json({"status": "reconnecting"})
                cap.release()
                cap = None
                cap = await run_in_threadpool(open_stream_capture, stream_url)
                if not cap.isOpened():
                    await send_stream_error(websocket, "流媒体重连失败：连接超时或地址不可用")
                    break
                continue
            reconnect_attempts = 0
            
            # 缩放帧以提高性能
            if resize_factor != 1.0:
                frame = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_NEAREST)
                
            # 帧计数器递增
            frame_count += 1
            
            # 创建一个处理后的帧副本
            processed_frame = frame.copy()
            
            # 检测逻辑 - 实现跳帧检测
            if frame_count % (skip_frames + 1) == 0:
                # 运行检测
                try:
                    # 异步运行检测
                    results = model(frame, verbose=False)  # 关闭verbose模式以减少输出
                    
                    # 处理检测结果
                    last_detections = []
                    
                    for result in results:
                        boxes = result.boxes
                        for box in boxes:
                            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                            conf = float(box.conf[0])
                            cls = int(box.cls[0])
                            
                            # 仅绘制高置信度的检测框
                            if conf > confidence_threshold:
                                # 在原始帧上绘制检测框
                                class_name = CLASS_NAMES.get(cls, f"未知类别-{cls}")
                                label = f"{class_name}: {conf:.2f}"
                                
                                # 绘制矩形框
                                cv2.rectangle(processed_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                                
                                # 使用支持中文的函数绘制标签文本
                                font_size = max(12, int(24 * resize_factor))
                                processed_frame = draw_chinese_text(processed_frame, label, (int(x1), int(y1) - 30), font_size=font_size, font_obj=font)
                                
                                last_detections.append({
                                    "bbox": [float(x1), float(y1), float(x2), float(y2)],
                                    "confidence": conf,
                                    "class": cls,
                                    "class_name": class_name
                                })
                except Exception as e:
                    print(f"检测过程错误: {e}")
            else:
                # 使用上一帧的检测结果绘制
                for det in last_detections:
                    x1, y1, x2, y2 = det["bbox"]
                    conf = det["confidence"]
                    cls = det["class"]
                    class_name = det["class_name"]
                    label = f"{class_name}: {conf:.2f}"
                    
                    # 绘制矩形框
                    cv2.rectangle(processed_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                    
                    # 使用支持中文的函数绘制标签文本
                    font_size = max(12, int(24 * resize_factor))
                    processed_frame = draw_chinese_text(processed_frame, label, (int(x1), int(y1) - 30), font_size=font_size, font_obj=font)
            
            # 添加时间戳
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            font_size = max(15, int(30 * resize_factor))
            processed_frame = draw_chinese_text(processed_frame, timestamp, (10, 30), font_size=font_size, font_obj=font)
            
            # 将帧编码为 JPEG，使用可调整的质量
            _, buffer = cv2.imencode('.jpg', processed_frame, [cv2.IMWRITE_JPEG_QUALITY, image_quality])
            frame_bytes = buffer.tobytes()
            
            # 发送帧和检测结果
            await websocket.send_bytes(frame_bytes)
            
            # 只在检测帧上发送JSON结果，减少网络传输
            if frame_count % (skip_frames + 1) == 0:
                await websocket.send_json({
                    "timestamp": time.time(),
                    "detections": last_detections
                })
            
            # 更新帧时间
            last_frame_time = time.time()
            
    except WebSocketDisconnect:
        pass
    except ValidationError as exc:
        await send_stream_error(websocket, stream_validation_message(exc))
    except json.JSONDecodeError:
        await send_stream_error(websocket, "流媒体参数错误：请提交有效 JSON 对象")
    except asyncio.TimeoutError:
        await send_stream_error(websocket, "等待流媒体参数超时，请重新连接")
    except Exception as e:
        print(f"流媒体处理错误: {e}")
        await send_stream_error(websocket, "流媒体处理失败，请检查地址或稍后重试")
    finally:
        if cap is not None:
            cap.release()
        if (websocket.client_state != WebSocketState.DISCONNECTED
                and websocket.application_state != WebSocketState.DISCONNECTED):
            await websocket.close()

@app.post("/test/stream-connection")
async def test_stream_connection(stream_data: StreamURL):
    """测试流媒体连接是否可用，所有退出路径均释放视频连接"""
    cap = None
    try:
        cap = await run_in_threadpool(open_stream_capture, stream_data.url)
        if not cap.isOpened():
            return {"success": False, "message": "无法连接到流媒体服务器：连接超时或地址不可用"}

        ret, frame = await run_in_threadpool(read_stream_frame, cap)
        if not ret or frame is None:
            return {"success": False, "message": "无法读取视频帧：读取超时或视频不可用"}

        height, width = frame.shape[:2]
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not np.isfinite(fps):
            fps = 0.0
        return {
            "success": True,
            "message": "流媒体连接成功",
            "video_info": {"width": width, "height": height, "fps": fps}
        }
    except Exception as e:
        print(f"流媒体连接测试错误: {e}")
        return {"success": False, "message": "流媒体连接测试失败，请检查地址或稍后重试"}
    finally:
        if cap is not None:
            cap.release()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001) 