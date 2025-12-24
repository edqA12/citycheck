import { ref } from 'vue'

// 检测绘制模块
export function createDetectionDrawer(canvasElement, videoElement) {
    const previousDetections = ref([]);
    const smoothingFactor = 0.3;

    // 应用平滑过渡
    const smoothDetection = (newDetection, prevDetection) => {
        if (!prevDetection) return newDetection;
        
        const [nx1, ny1, nx2, ny2] = newDetection.bbox;
        const [px1, py1, px2, py2] = prevDetection.bbox;
        
        // 平滑边界框坐标
        const smoothX1 = px1 + smoothingFactor * (nx1 - px1);
        const smoothY1 = py1 + smoothingFactor * (ny1 - py1);
        const smoothX2 = px2 + smoothingFactor * (nx2 - px2);
        const smoothY2 = py2 + smoothingFactor * (ny2 - py2);
        
        // 平滑置信度
        const smoothConf = prevDetection.confidence + smoothingFactor * (newDetection.confidence - prevDetection.confidence);
        
        return {
            ...newDetection,
            bbox: [smoothX1, smoothY1, smoothX2, smoothY2],
            confidence: smoothConf
        };
    };

    // 查找匹配的先前检测结果
    const findMatchingPrevDetection = (detection, prevDetections) => {
        if (!prevDetections || prevDetections.length === 0) return null;
        
        // 如果类别相同且边界框有足够的重叠，则认为是同一个物体
        const [x1, y1, x2, y2] = detection.bbox;
        const detectionArea = (x2 - x1) * (y2 - y1);
        
        let bestMatch = null;
        let bestIoU = 0.3; // 最小IoU阈值
        
        for (const prev of prevDetections) {
            if (prev.class !== detection.class) continue;
            
            const [px1, py1, px2, py2] = prev.bbox;
            
            // 计算交集区域
            const ix1 = Math.max(x1, px1);
            const iy1 = Math.max(y1, py1);
            const ix2 = Math.min(x2, px2);
            const iy2 = Math.min(y2, py2);
            
            if (ix2 < ix1 || iy2 < iy1) continue; // 没有交集
            
            const intersectionArea = (ix2 - ix1) * (iy2 - iy1);
            const prevArea = (px2 - px1) * (py2 - py1);
            const unionArea = detectionArea + prevArea - intersectionArea;
            const iou = intersectionArea / unionArea;
            
            if (iou > bestIoU) {
                bestIoU = iou;
                bestMatch = prev;
            }
        }
        
        return bestMatch;
    };

    // 绘制检测结果
    const drawDetections = (detections) => {
        const canvas = canvasElement.value;
        const ctx = canvas.getContext('2d');
        const video = videoElement.value;

        // 设置 canvas 尺寸与视频一致
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // 清除上一帧的绘制
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 如果没有检测结果，则清空上一帧记录并返回
        if (!detections || detections.length === 0) {
            previousDetections.value = [];
            return;
        }
        
        // 处理每个检测结果
        const smoothedDetections = detections.map(detection => {
            // 查找匹配的先前检测结果
            const prevDetection = findMatchingPrevDetection(detection, previousDetections.value);
            // 应用平滑过渡
            return prevDetection ? smoothDetection(detection, prevDetection) : detection;
        });
        
        // 更新上一帧检测结果
        previousDetections.value = [...smoothedDetections];

        // 绘制新的检测框
        smoothedDetections.forEach(detection => {
            const [x1, y1, x2, y2] = detection.bbox;
            const className = detection.class_name || `类别 ${detection.class}`;
            
            // 根据类别设置不同的颜色
            let color = 'red';
            
            // 为不同类型的物体设置不同颜色
            if (detection.class >= 0 && detection.class <= 4) {
                // 井盖相关
                color = '#e74c3c';
            } else if (detection.class >= 5 && detection.class <= 6) {
                // 法兰和管道
                color = '#3498db';
            } else if (detection.class >= 7 && detection.class <= 16) {
                // 工程车辆
                color = '#2ecc71';
            }
            
            // 计算边界框尺寸
            const boxWidth = x2 - x1;
            const boxHeight = y2 - y1;
            
            // 绘制边界框 - 使用圆角矩形
            ctx.strokeStyle = color;
            ctx.lineWidth = 4; // 增加线宽
            
            // 绘制圆角矩形
            const radius = 8; // 增加圆角半径
            ctx.beginPath();
            ctx.moveTo(x1 + radius, y1);
            ctx.lineTo(x2 - radius, y1);
            ctx.quadraticCurveTo(x2, y1, x2, y1 + radius);
            ctx.lineTo(x2, y2 - radius);
            ctx.quadraticCurveTo(x2, y2, x2 - radius, y2);
            ctx.lineTo(x1 + radius, y2);
            ctx.quadraticCurveTo(x1, y2, x1, y2 - radius);
            ctx.lineTo(x1, y1 + radius);
            ctx.quadraticCurveTo(x1, y1, x1 + radius, y1);
            ctx.closePath();
            ctx.stroke();
            
            // 添加阴影效果
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            
            // 绘制半透明背景，使文字更容易阅读
            const labelBgHeight = 40; // 增加标签高度
            const labelWidth = Math.min(Math.max(boxWidth, 180), 300); // 确保标签宽度适中
            
            // 绘制标签背景 - 顶部
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + labelWidth, y1);
            ctx.lineTo(x1 + labelWidth, y1 + labelBgHeight);
            ctx.lineTo(x1, y1 + labelBgHeight);
            ctx.closePath();
            ctx.fill();
            
            // 重置阴影，避免影响文字
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // 绘制类别名称和置信度
            ctx.fillStyle = 'white';
            ctx.font = 'bold 18px Arial'; // 增大字体
            
            // 计算置信度百分比
            const confidenceText = `${(detection.confidence * 100).toFixed(1)}%`;
            
            // 绘制类别名称
            ctx.fillText(className, x1 + 10, y1 + 25);
            
            // 绘制置信度 - 使用较小字体
            ctx.font = '14px Arial';
            ctx.fillText(confidenceText, x1 + 10, y1 + 45);
            
            // 如果边界框足够大，在中心添加类别图标
            if (boxWidth > 100 && boxHeight > 100) {
                let icon = '';
                
                // 根据类别选择图标
                if (detection.class >= 0 && detection.class <= 4) {
                    icon = '\uf1b3'; // 井盖图标 (fa-cubes)
                } else if (detection.class >= 5 && detection.class <= 6) {
                    icon = '\uf043'; // 管道图标 (fa-tint)
                } else if (detection.class >= 7 && detection.class <= 16) {
                    icon = '\uf1b9'; // 车辆图标 (fa-car)
                }
                
                if (icon) {
                    // 绘制半透明图标背景
                    const centerX = (x1 + x2) / 2;
                    const centerY = (y1 + y2) / 2;
                    const iconSize = Math.min(boxWidth, boxHeight) * 0.3;
                    
                    ctx.fillStyle = `${color}40`; // 添加透明度
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, iconSize / 1.5, 0, Math.PI * 2);
                    ctx.fill();
                    
                    // 绘制图标
                    ctx.fillStyle = 'white';
                    ctx.font = `${iconSize}px "Font Awesome 5 Free"`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(icon, centerX, centerY);
                    
                    // 重置文本对齐方式
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';
                }
            }
        });
    };

    return {
        drawDetections
    };
} 