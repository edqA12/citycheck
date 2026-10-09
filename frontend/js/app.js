import { createApp, ref, onMounted, onBeforeUnmount, computed, watch } from "vue";
import ElementPlus from "element-plus";
import { createVideoController } from "./modules/videoController.js";
import { createDetectionStats } from "./modules/detectionStats.js";
import { createChartController } from "./modules/chartController.js";
import { createDetectionDrawer } from "./modules/detectionDrawer.js";
import { createWebSocketController } from "./modules/websocketController.js";
import { createStreamController } from "./modules/streamController.js";

const app = createApp({
  setup() {
    // 基本引用
    const videoElement = ref(null);
    const canvasElement = ref(null);
    const progressContainer = ref(null);
    const pieChartElement = ref(null);
    const stream = ref(null);
    const isVideoActive = ref(false);
    const videoAspectRatio = ref("16/9");
    const isCameraMode = ref(false);
    const isStreamMode = ref(false); // 添加流媒体模式标志
    const streamUrl = ref(""); // 添加流媒体地址
    const warningMessage = ref(""); // 警告信息
    const showWarning = computed(() => Boolean(warningMessage.value));
    const dismissWarning = () => {
      warningMessage.value = "";
    };

    let captureTimer = null;
    let captureGeneration = 0;
    let videoObjectUrl = null;
    const stopFrameCapture = () => {
      captureGeneration++;
      if (captureTimer !== null) {
        clearTimeout(captureTimer);
        captureTimer = null;
      }
    };

    // 初始化各个模块
    const videoController = createVideoController(
      videoElement,
      progressContainer
    );
    const detectionStats = createDetectionStats();
    const chartController = createChartController(pieChartElement);
    const detectionDrawer = createDetectionDrawer(canvasElement, videoElement);
    const websocketController = createWebSocketController(
      (data) => {
        detectionDrawer.drawDetections(data.detections);
        detectionStats.updateDetectionStats(data.detections);
        chartController.updatePieChart(detectionStats.detectionClasses.value);
      },
      (error) => {
        console.error("检测错误:", error);
        warningMessage.value = error?.message || "检测连接失败，请检查后端服务是否运行";
      }
    );

    // 初始化流媒体控制器
    const streamController = createStreamController(
      videoElement,
      canvasElement
    );
    const restoreStreamWaiting = (message) => {
      streamController.stopStreamDetection();
      isStreamMode.value = false;
      isVideoActive.value = false;
      websocketController.detectionStatus.value = message;
    };
    watch(streamController.streamErrorMessage, (message) => {
      if (message) {
        warningMessage.value = message;
        if (isStreamMode.value) restoreStreamWaiting(message);
      }
    });
    watch(streamController.isStreamDetecting, (active) => {
      if (isStreamMode.value) isVideoActive.value = active;
    });

    // 添加流媒体检测回调处理
    streamController.setDetectionCallback((data) => {
      if (data.detections) {
        detectionStats.updateDetectionStats(data.detections);
        chartController.updatePieChart(detectionStats.detectionClasses.value);
      }
    });

    // 开启摄像头
    const startCamera = async () => {
      dismissWarning();
      try {
        // 切换输入前释放旧视频、摄像头和流媒体连接
        stopCamera();

        console.log("正在尝试访问摄像头...");

        // 重置检测统计
        detectionStats.resetDetectionStats();

        // 检查videoElement是否已正确引用
        if (!videoElement.value) {
          console.error("videoElement未找到");
          warningMessage.value = "视频元素未初始化，请刷新页面重试";
          return;
        }

        // 设置为摄像头模式
        isCameraMode.value = true;
        isStreamMode.value = false;

        // 显示视频元素，隐藏Canvas（Camera模式使用video+canvas叠加）
        videoElement.value.style.display = "block";

        // 尝试获取媒体流
        stream.value = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        console.log("摄像头访问成功，设置视频源...");
        videoElement.value.srcObject = stream.value;

        // 添加事件监听器确认视频已加载
        videoElement.value.onloadedmetadata = () => {
          console.log("视频元数据已加载，开始检测...");
          isVideoActive.value = true;
          videoController.isPlaying.value = true;

          // 设置视频宽高比
          const width = videoElement.value.videoWidth;
          const height = videoElement.value.videoHeight;
          videoAspectRatio.value = `${width}/${height}`;

          // 设置canvas尺寸与视频一致
          canvasElement.value.width = width;
          canvasElement.value.height = height;

          // 开始检测
          startCameraDetection();
        };
      } catch (err) {
        console.error("摄像头访问失败:", err);
        websocketController.detectionStatus.value = "摄像头访问失败";
        warningMessage.value = "无法访问摄像头，请确保已授予权限。错误: " + err.message;
      }
    };

    // 每个输入只保留一个取帧任务，停止后丢弃尚未完成的编码结果
    const startFrameCapture = (cameraMode) => {
      stopFrameCapture();
      const generation = captureGeneration;
      const video = videoElement.value;
      const captureCanvas = document.createElement("canvas");
      const captureCtx = captureCanvas.getContext("2d");
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const isCurrentCapture = () =>
        generation === captureGeneration &&
        websocketController.isDetecting.value &&
        isVideoActive.value &&
        !isStreamMode.value &&
        isCameraMode.value === cameraMode;
      const captureAndSendFrame = () => {
        captureTimer = null;
        if (!isCurrentCapture() || (!cameraMode && (video.paused || video.ended))) {
          return;
        }
        if (websocketController.ws.value?.readyState === WebSocket.OPEN) {
          captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
          captureCanvas.toBlob((blob) => {
            if (blob && isCurrentCapture()) websocketController.sendData(blob);
          }, "image/jpeg", 0.8);
        }
        captureTimer = setTimeout(captureAndSendFrame, 100);
      };
      captureAndSendFrame();
    };

    // 摄像头检测函数
    const startCameraDetection = () => {
      websocketController.startDetection();
      startFrameCapture(true);
    };

    // 停止摄像头
    const stopCamera = () => {
      console.log("停止摄像头和检测...");

      // 在清除模式标志前关闭两种连接并取消取帧
      stopStreamDetection();
      stopFrameCapture();
      websocketController.stopDetection();

      // 停止媒体流
      if (stream.value) {
        console.log("停止媒体流...");
        try {
          stream.value.getTracks().forEach((track) => {
            track.stop();
            console.log("媒体轨道已停止");
          });
        } catch (e) {
          console.error("停止媒体轨道时出错:", e);
        }
        stream.value = null;
      }

      // 清除视频源
      if (videoElement.value) {
        console.log("清除视频源...");
        try {
          videoElement.value.onloadedmetadata = null;
          videoElement.value.pause();
          videoElement.value.srcObject = null;
          videoElement.value.removeAttribute("src");
          videoElement.value.load();
        } catch (e) {
          console.error("清除视频源时出错:", e);
        }
      }

      if (videoObjectUrl) {
        URL.revokeObjectURL(videoObjectUrl);
        videoObjectUrl = null;
      }

      // 清除画布
      if (canvasElement.value) {
        console.log("清除画布...");
        try {
          const ctx = canvasElement.value.getContext("2d");
          ctx.clearRect(
            0,
            0,
            canvasElement.value.width,
            canvasElement.value.height
          );
        } catch (e) {
          console.error("清除画布时出错:", e);
        }
      }

      // 重置状态
      isVideoActive.value = false;
      videoController.isPlaying.value = false;
      isCameraMode.value = false;
      isStreamMode.value = false;
      videoController.currentTime.value = 0;
      videoController.duration.value = 0;
      videoController.videoProgress.value = 0;

      console.log("摄像头和检测已停止");
    };

    // 处理文件上传
    const handleFileUpload = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      dismissWarning();

      // 停止之前的摄像头和流媒体检测
      stopCamera();

      // 重置检测统计
      detectionStats.resetDetectionStats();

      // 设置为视频模式（非摄像头、非流媒体）
      isCameraMode.value = false;
      isStreamMode.value = false;

      // 显示视频元素
      videoElement.value.style.display = "block";

      // 创建视频元素
      const video = videoElement.value;
      videoObjectUrl = URL.createObjectURL(file);
      video.src = videoObjectUrl;
      event.target.value = "";
      video.controls = false; // 使用自定义控制

      // 当视频元数据加载完成后
      video.onloadedmetadata = () => {
        console.log("视频元数据已加载");

        // 设置canvas尺寸与视频一致
        canvasElement.value.width = video.videoWidth;
        canvasElement.value.height = video.videoHeight;

        // 设置视频宽高比
        const width = video.videoWidth;
        const height = video.videoHeight;
        videoAspectRatio.value = `${width}/${height}`;

        // 激活视频显示
        isVideoActive.value = true;

        // 开始检测
        startVideoDetection();

        // 设置初始音量
        video.volume = videoController.volume.value;

        // 播放视频
        video
          .play()
          .then(() => {
            videoController.isPlaying.value = true;
          })
          .catch((err) => {
            console.error("视频播放失败:", err);
            videoController.isPlaying.value = false;
          });
      };

    };

    // 播放和重播都会启动检测，暂停时取消取帧
    const startVideoDetection = () => {
      if (!isVideoActive.value || isCameraMode.value || isStreamMode.value) return;
      websocketController.startDetection();
      if (!videoElement.value.paused && !videoElement.value.ended) {
        startFrameCapture(false);
      }
    };
    const handleVideoPlay = () => {
      videoController.isPlaying.value = true;
      startVideoDetection();
    };
    const handleVideoPause = () => {
      videoController.isPlaying.value = false;
      if (!isCameraMode.value) stopFrameCapture();
    };
    const handleVideoEnded = () => {
      if (isCameraMode.value || isStreamMode.value) return;
      stopFrameCapture();
      websocketController.stopDetection();
      videoController.isPlaying.value = false;
      websocketController.detectionStatus.value = "视频播放完毕";
    };
    const handleVolumeChange = () => {
      videoController.volume.value = videoElement.value.volume;
      videoController.isMuted.value = videoElement.value.muted;
    };

    // 开始流媒体检测
    const startStreamDetection = async () => {
      const targetUrl = streamUrl.value.trim();
      if (!targetUrl) {
        warningMessage.value = "请输入流媒体地址";
        return;
      }
      dismissWarning();
      console.log("开始流媒体检测:", targetUrl);

      // 地址有效后再切换检测模式
      stopCamera();
      detectionStats.resetDetectionStats();
      streamController.streamErrorMessage.value = "";
      isStreamMode.value = true;
      isVideoActive.value = false;

      const result = await streamController.startStreamDetection(targetUrl);
      // 等待期间切换模式或发生错误时，关闭迟到的连接
      if (!isStreamMode.value) {
        streamController.stopStreamDetection();
        return;
      }
      if (result) {
        websocketController.detectionStatus.value =
          streamController.streamStatus.value;
        isVideoActive.value = streamController.isStreamDetecting.value;
      } else {
        const message = streamController.streamErrorMessage.value ||
          "流媒体连接失败，请检查地址和后端服务";
        warningMessage.value = message;
        restoreStreamWaiting(message);
      }
    };

    // 停止流媒体检测
    const stopStreamDetection = () => {
      const wasStreamMode = isStreamMode.value;
      streamController.stopStreamDetection();
      if (wasStreamMode) {
        isStreamMode.value = false;
        isVideoActive.value = false;
        websocketController.detectionStatus.value = "流媒体检测已停止";
      }
    };

    // 状态徽章的CSS类
    const statusClass = computed(() => {
      if (
        isCameraMode.value ||
        isStreamMode.value ||
        videoController.isPlaying.value
      ) {
        return "status-badge-active";
      } else if (
        websocketController.detectionStatus.value.includes("错误") ||
        streamController.streamStatus.value.includes("错误")
      ) {
        return "status-badge-error";
      } else {
        return "status-badge-inactive";
      }
    });

    // 状态图标
    const statusIcon = computed(() => {
      if (isCameraMode.value) {
        return "fas fa-camera";
      } else if (isStreamMode.value) {
        return "fas fa-stream";
      } else if (videoController.isPlaying.value) {
        return "fas fa-file-video";
      } else if (
        websocketController.detectionStatus.value.includes("错误") ||
        streamController.streamStatus.value.includes("错误")
      ) {
        return "fas fa-exclamation-circle";
      } else {
        return "fas fa-pause-circle";
      }
    });

    // 检测状态
    const detectionStatus = computed(() => {
      if (isStreamMode.value) {
        return streamController.streamStatus.value;
      } else if (
        isVideoActive.value &&
        !isCameraMode.value &&
        !videoController.isPlaying.value &&
        videoElement.value?.ended
      ) {
        return "视频播放完毕";
      } else {
        return websocketController.detectionStatus.value;
      }
    });

    const resizeCanvas = () => {
      if (videoElement.value && canvasElement.value) {
        canvasElement.value.width = videoElement.value.videoWidth;
        canvasElement.value.height = videoElement.value.videoHeight;
      }
    };

    const handleKeydown = (event) => {
      if (event.code === "Space" && isVideoActive.value && !isCameraMode.value) {
        videoController.togglePlay();
        event.preventDefault();
      }
    };

    onMounted(() => {
      chartController.initPieChart();
      if (videoElement.value) {
        videoElement.value.addEventListener("loadedmetadata", resizeCanvas);
        videoElement.value.addEventListener("timeupdate", videoController.updateVideoProgress);
        videoElement.value.addEventListener("play", handleVideoPlay);
        videoElement.value.addEventListener("pause", handleVideoPause);
        videoElement.value.addEventListener("ended", handleVideoEnded);
        videoElement.value.addEventListener("volumechange", handleVolumeChange);
      }
      window.addEventListener("resize", resizeCanvas);
      window.addEventListener("keydown", handleKeydown);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("keydown", handleKeydown);
      if (videoElement.value) {
        videoElement.value.removeEventListener("loadedmetadata", resizeCanvas);
        videoElement.value.removeEventListener("play", handleVideoPlay);
        videoElement.value.removeEventListener("pause", handleVideoPause);
        videoElement.value.removeEventListener("ended", handleVideoEnded);
        videoElement.value.removeEventListener("volumechange", handleVolumeChange);
        videoElement.value.removeEventListener(
          "timeupdate",
          videoController.updateVideoProgress
        );
      }
      stopCamera();
    });

    return {
      videoElement,
      canvasElement,
      progressContainer,
      pieChartElement,
      isVideoActive,
      videoAspectRatio,
      isCameraMode,
      isStreamMode,
      streamUrl,
      warningMessage,
      showWarning,
      dismissWarning,
      ...videoController,
      ...detectionStats,
      detectionStatus,
      statusClass,
      statusIcon,
      startCamera,
      stopCamera,
      handleFileUpload,
      startStreamDetection,
      stopStreamDetection,
      isStreamDetecting: streamController.isStreamDetecting,
    };
  },
});

app.use(ElementPlus);
app.mount("#app");
