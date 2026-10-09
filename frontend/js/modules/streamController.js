import { ref, watch } from "vue";

export function createStreamController(videoElement, canvasElement) {
  const apiHost = window.location.hostname || "localhost";
  const ws = ref(null);
  const isStreamDetecting = ref(false);
  const streamUrl = ref("");
  const streamStatus = ref("未连接");
  const streamErrorMessage = ref("");
  const reconnectAttempts = ref(0);
  const maxReconnectAttempts = 5;

  // 性能设置 - 优化默认值
  const targetFps = ref(30); // 提高默认帧率到30
  const skipFrames = ref(3); // 增加跳帧检测，每4帧检测一次
  const imageQuality = ref(60); // 降低JPEG质量以加快传输
  const resizeFactor = ref(0.6); // 进一步缩小图像尺寸以提高性能

  // 测试流媒体连接
  const testStreamConnection = async (url) => {
    try {
      // 发送测试请求 - 直连后端
      const response = await fetch(
        `${window.location.protocol === "https:" ? "https:" : "http:"}//${apiHost}:8001/test/stream-connection`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url, fps: targetFps.value }),
        }
      );

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("测试流媒体连接错误:", error);
      return { success: false, message: `连接错误: ${error.message}` };
    }
  };

  // 开始流媒体检测
  const startStreamDetection = async (url) => {
    // 如果没有提供URL，使用输入框中的URL
    const targetUrl = url || streamUrl.value;

    if (!targetUrl) {
      streamErrorMessage.value = "请输入流媒体地址";
      streamStatus.value = "未提供流媒体地址";
      return false;
    }

    // 如果已经在检测，先停止
    if (isStreamDetecting.value) {
      stopStreamDetection();
    }

    streamStatus.value = "正在连接...";

    // 先测试连接
    const testResult = await testStreamConnection(targetUrl);
    if (!testResult.success) {
      streamErrorMessage.value = testResult.message;
      streamStatus.value = `连接失败: ${testResult.message}`;
      return false;
    }

    // 记录流媒体地址
    streamUrl.value = targetUrl;
    reconnectAttempts.value = 0;
    streamErrorMessage.value = "";

    // 开始WebSocket连接
    return connectWebSocket();
  };

  // 停止流媒体检测
  const stopStreamDetection = () => {
    isStreamDetecting.value = false;
    streamStatus.value = "已断开连接";

    if (ws.value) {
      try {
        ws.value.close();
      } catch (e) {
        console.error("关闭WebSocket时出错:", e);
      }
      ws.value = null;
    }

    // 清除Canvas上的内容
    if (canvasElement.value) {
      const ctx = canvasElement.value.getContext("2d");
      ctx.clearRect(
        0,
        0,
        canvasElement.value.width,
        canvasElement.value.height
      );
    }
  };

  // 连接WebSocket
  const connectWebSocket = () => {
    try {
      // 创建新的WebSocket连接 - 直接连接到后端
      console.log("正在连接流媒体WebSocket...");
      // 根据当前环境判断WebSocket地址
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = `${apiHost}:8001`; // 直连后端WebSocket服务器
      ws.value = new WebSocket(`${wsProtocol}//${wsHost}/ws/stream`);

      ws.value.onopen = () => {
        console.log("流媒体WebSocket连接已建立");
        // 发送流媒体地址和性能优化参数
        ws.value.send(
          JSON.stringify({
            stream_url: streamUrl.value,
            fps: targetFps.value,
            skip_frames: skipFrames.value,
            image_quality: imageQuality.value,
            resize_factor: resizeFactor.value,
          })
        );
        streamStatus.value = "正在连接流媒体...";
      };

      ws.value.onmessage = (event) => {
        // 处理字节数据（视频帧）或JSON数据（检测结果）
        if (event.data instanceof Blob) {
          // 处理视频帧 - 使用更高效的方式
          const url = URL.createObjectURL(event.data);
          const img = new Image();

          // 使用加载事件只执行一次
          img.onload = () => {
            if (canvasElement.value) {
              const ctx = canvasElement.value.getContext("2d");
              // 确保Canvas尺寸与图像一致
              if (
                canvasElement.value.width !== img.width ||
                canvasElement.value.height !== img.height
              ) {
                canvasElement.value.width = img.width;
                canvasElement.value.height = img.height;
              }

              // 使用更高效的绘制方式
              ctx.clearRect(
                0,
                0,
                canvasElement.value.width,
                canvasElement.value.height
              );
              ctx.drawImage(img, 0, 0);

              // 立即释放 URL 对象
              URL.revokeObjectURL(url);
            } else {
              URL.revokeObjectURL(url);
            }
          };

          // 错误处理
          img.onerror = () => {
            console.error("图像加载失败");
            URL.revokeObjectURL(url);
          };

          // 开始加载图像
          img.src = url;
        } else {
          // 处理JSON消息
          try {
            const data = JSON.parse(event.data);

            if (data.error) {
              streamErrorMessage.value = data.error;
              streamStatus.value = `错误: ${data.error}`;
              isStreamDetecting.value = false;
            } else if (data.status === "connected") {
              isStreamDetecting.value = true;
              streamStatus.value = "流媒体连接成功，正在检测...";

              // 设置Canvas尺寸
              if (data.video_info && canvasElement.value) {
                canvasElement.value.width = data.video_info.width;
                canvasElement.value.height = data.video_info.height;

                // 更改video容器比例
                if (videoElement.value) {
                  videoElement.value.style.display = "none"; // 隐藏视频元素，只使用Canvas
                }
              }
            } else if (data.status === "reconnecting") {
              streamStatus.value = "流媒体连接中断，正在重连...";
            } else if (data.detections) {
              // 减少不必要的UI更新，只在检测数量变化时更新
              const detectionCount = data.detections.length;
              if (
                streamStatus.value !== `检测中: 检测到 ${detectionCount} 个对象`
              ) {
                streamStatus.value = `检测中: 检测到 ${detectionCount} 个对象`;
              }

              // 将检测结果传递给外部回调
              if (onDetection) {
                onDetection(data);
              }
            }
          } catch (e) {
            console.error("解析WebSocket消息出错:", e);
          }
        }
      };

      ws.value.onerror = (error) => {
        console.error("流媒体WebSocket错误:", error);
        streamStatus.value = "连接错误";
        streamErrorMessage.value = "连接错误";
      };

      ws.value.onclose = (event) => {
        console.log(
          `流媒体WebSocket连接已关闭，代码: ${event.code}, 原因: ${event.reason}`
        );

        if (
          isStreamDetecting.value &&
          reconnectAttempts.value < maxReconnectAttempts
        ) {
          reconnectAttempts.value++;
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttempts.value),
            10000
          );
          streamStatus.value = `连接已断开，${delay / 1000}秒后尝试重新连接...`;

          // 尝试重新连接
          setTimeout(() => {
            if (isStreamDetecting.value) {
              connectWebSocket();
            }
          }, delay);
        } else if (reconnectAttempts.value >= maxReconnectAttempts) {
          streamStatus.value = "重连失败，请检查服务器状态后重试";
          isStreamDetecting.value = false;
        } else {
          streamStatus.value = "流媒体连接已断开";
          isStreamDetecting.value = false;
        }
      };

      return true;
    } catch (e) {
      console.error("创建WebSocket连接时出错:", e);
      streamStatus.value = "无法连接到服务器";
      streamErrorMessage.value = "无法连接到服务器";
      return false;
    }
  };

  // 回调函数
  let onDetection = null;

  // 设置检测回调
  const setDetectionCallback = (callback) => {
    onDetection = callback;
  };

  // 设置性能参数
  const setPerformanceSettings = (fps, skip, quality, resize) => {
    if (fps) targetFps.value = fps;
    if (skip !== undefined) skipFrames.value = skip;
    if (quality) imageQuality.value = quality;
    if (resize) resizeFactor.value = resize;
  };

  return {
    streamUrl,
    isStreamDetecting,
    streamStatus,
    streamErrorMessage,
    targetFps,
    skipFrames,
    imageQuality,
    resizeFactor,
    startStreamDetection,
    stopStreamDetection,
    setDetectionCallback,
    setPerformanceSettings,
  };
}
