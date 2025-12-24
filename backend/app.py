from fastapi import FastAPI, WebSocket, UploadFile, File
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
from pydantic import BaseModel
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
model = YOLO('best.pt')

# 类别名称映射
CLASS_NAMES = {
    0: '井盖破损', 1: '井圈问题', 2: '井盖完好', 3: '井盖缺失', 4: '井盖未盖', 
    5: '法兰', 6: '管道', 7: '挖掘机', 8: '卡车', 9: '压路机', 10: '吊车', 
    11: '塔吊', 12: '装载机', 13: '搅拌车', 14: '挖掘装载机', 15: '推土机', 16: '平地机'
}

# 流媒体地址模型
class StreamURL(BaseModel):
    url: str
    fps: int = 15  # 默认处理帧率

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
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
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
            
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()

@app.websocket("/ws/stream")
async def stream_detection(websocket: WebSocket):
    """从流媒体服务器拉流并进行检测"""
    await websocket.accept()
    cap = None
    
    try:
        # 接收流媒体地址
        data = await websocket.receive_json()
        stream_url = data.get("stream_url")
        target_fps = data.get("fps", 30)  # 默认 30fps
        skip_frames = data.get("skip_frames", 3)  # 跳帧参数，每隔几帧检测一次
        image_quality = data.get("image_quality", 60)  # JPEG压缩质量
        resize_factor = data.get("resize_factor", 0.6)  # 图像缩放因子，减小可提高性能
        
        # 置信度阈值
        confidence_threshold = 0.5
        
        if not stream_url:
            await websocket.send_json({"error": "未提供流媒体地址"})
            return
            
        # 连接到流媒体服务器
        cap = cv2.VideoCapture(stream_url)
        if not cap.isOpened():
            await websocket.send_json({"error": "无法连接到流媒体服务器"})
            return
        
        # 尝试优化视频捕获缓冲设置
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)  # 设置较小的缓冲区
            
        # 获取视频信息
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # 根据缩放因子计算目标尺寸
        target_width = int(width * resize_factor)
        target_height = int(height * resize_factor)
        
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
            
            # 清除缓冲区中的旧帧 (减少延迟)
            if frame_count % 10 == 0:  # 每10帧执行一次
                for _ in range(2):  # 丢弃2帧
                    cap.grab()
            
            # 读取一帧
            ret, frame = cap.read()
            if not ret:
                # 尝试重新连接
                await websocket.send_json({"status": "reconnecting"})
                cap.release()
                cap = cv2.VideoCapture(stream_url)
                if not cap.isOpened():
                    await websocket.send_json({"error": "流媒体连接中断"})
                    break
                continue
            
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
            
    except Exception as e:
        print(f"流媒体处理错误: {e}")
        await websocket.send_json({"error": f"处理错误: {str(e)}"})
    finally:
        if cap is not None and cap.isOpened():
            cap.release()
        await websocket.close()

@app.post("/test/stream-connection")
async def test_stream_connection(stream_data: StreamURL):
    """测试流媒体连接是否可用"""
    try:
        cap = cv2.VideoCapture(stream_data.url)
        if not cap.isOpened():
            return {"success": False, "message": "无法连接到流媒体服务器"}
        
        # 尝试读取一帧
        ret, _ = cap.read()
        if not ret:
            cap.release()
            return {"success": False, "message": "无法读取视频帧"}
        
        # 获取视频信息
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        
        cap.release()
        return {
            "success": True, 
            "message": "流媒体连接成功",
            "video_info": {
                "width": width,
                "height": height,
                "fps": fps
            }
        }
    except Exception as e:
        return {"success": False, "message": f"连接错误: {str(e)}"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001) 