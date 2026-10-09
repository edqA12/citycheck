import { ref } from 'vue'

// WebSocket连接模块
export function createWebSocketController(onMessage, onError) {
    const ws = ref(null);
    const isDetecting = ref(false);
    const detectionStatus = ref('未开始检测');
    const reconnectAttempts = ref(0);
    const maxReconnectAttempts = 5;

    // 开始检测
    const startDetection = () => {
        if (!isDetecting.value) {
            isDetecting.value = true;
            detectionStatus.value = '检测中...';
            reconnectAttempts.value = 0;
            connectWebSocket();
        }
    };

    // 停止检测
    const stopDetection = () => {
        isDetecting.value = false;
        detectionStatus.value = '已停止检测';
        reconnectAttempts.value = 0;
        if (ws.value) {
            try {
                ws.value.close();
            } catch (e) {
                console.error('关闭WebSocket时出错:', e);
            }
            ws.value = null;
        }
    };

    // 连接WebSocket
    const connectWebSocket = () => {
        try {
            // 检查之前的连接是否存在，如果存在则关闭
            if (ws.value) {
                try {
                    ws.value.close();
                } catch (e) {
                    console.error('关闭旧WebSocket连接时出错:', e);
                }
            }
            
            // 创建新的WebSocket连接
            console.log('正在连接WebSocket...');
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = window.location.hostname || 'localhost';
            ws.value = new WebSocket(`${wsProtocol}//${wsHost}:8001/ws/detect`);
            
            ws.value.onopen = () => {
                console.log('WebSocket 连接已建立');
                detectionStatus.value = '检测中...';
                reconnectAttempts.value = 0; // 重置重连计数
            };

            ws.value.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    onMessage(data);
                } catch (e) {
                    console.error('解析WebSocket消息时出错:', e);
                    onError(new Error('无法解析检测结果'));
                }
            };

            ws.value.onerror = (error) => {
                console.error('WebSocket 错误:', error);
                detectionStatus.value = '检测出错';
                onError(error);
            };

            ws.value.onclose = (event) => {
                console.log(`WebSocket 连接已关闭，代码: ${event.code}, 原因: ${event.reason}`);
                
                if (isDetecting.value && reconnectAttempts.value < maxReconnectAttempts) {
                    reconnectAttempts.value++;
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.value), 10000);
                    detectionStatus.value = `连接已断开，${delay/1000}秒后尝试重新连接...`;
                    
                    // 尝试重新连接
                    setTimeout(() => {
                        if (isDetecting.value) {
                            connectWebSocket();
                        }
                    }, delay);
                } else if (reconnectAttempts.value >= maxReconnectAttempts) {
                    detectionStatus.value = '重连失败，请检查服务器状态后重试';
                    isDetecting.value = false;
                } else {
                    detectionStatus.value = '检测已停止';
                }
            };
        } catch (e) {
            console.error('创建WebSocket连接时出错:', e);
            detectionStatus.value = '无法连接到检测服务器';
            onError(new Error('无法连接到检测服务器'));
        }
    };

    // 发送数据
    const sendData = (data) => {
        if (ws.value && ws.value.readyState === WebSocket.OPEN) {
            try {
                ws.value.send(data);
            } catch (e) {
                console.error('发送数据到WebSocket时出错:', e);
                onError(new Error('发送数据失败'));
            }
        } else if (isDetecting.value) {
            console.warn('WebSocket未连接，无法发送数据');
            // 如果WebSocket未连接但检测标志为true，尝试重新连接
            if (!ws.value || ws.value.readyState === WebSocket.CLOSED) {
                connectWebSocket();
            }
        }
    };

    return {
        ws,
        isDetecting,
        detectionStatus,
        startDetection,
        stopDetection,
        sendData
    };
} 