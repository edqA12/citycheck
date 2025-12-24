import { createApp, ref, onMounted, onUnmounted, computed } from "vue";
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
      }
    );

    // 初始化流媒体控制器
    const streamController = createStreamController(
      videoElement,
      canvasElement
    );

    // 添加流媒体检测回调处理
    streamController.setDetectionCallback((data) => {
      if (data.detections) {
        detectionStats.updateDetectionStats(data.detections);
        chartController.updatePieChart(detectionStats.detectionClasses.value);
      }
    });

    // 开启摄像头
    const startCamera = async () => {
      try {
        // 如果流媒体模式活跃，先停止
        if (isStreamMode.value) {
          stopStreamDetection();
        }

        console.log("正在尝试访问摄像头...");

        // 重置检测统计
        detectionStats.resetDetectionStats();

        // 检查videoElement是否已正确引用
        if (!videoElement.value) {
          console.error("videoElement未找到");
          alert("视频元素未初始化，请刷新页面重试");
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
        alert("无法访问摄像头，请确保已授予权限。错误: " + err.message);
      }
    };

    // 摄像头检测函数
    const startCameraDetection = () => {
      if (!websocketController.isDetecting.value) {
        websocketController.startDetection();

        // 创建一个canvas用于捕获视频帧
        const captureCanvas = document.createElement("canvas");
        const captureCtx = captureCanvas.getContext("2d");
        const video = videoElement.value;

        // 设置捕获canvas的尺寸
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;

        // 定义捕获和发送帧的函数
        const captureAndSendFrame = () => {
          if (!websocketController.isDetecting.value || !isCameraMode.value) {
            return; // 如果检测已停止或不再是摄像头模式，则退出
          }

          // 捕获当前视频帧
          captureCtx.drawImage(
            video,
            0,
            0,
            captureCanvas.width,
            captureCanvas.height
          );

          // 将帧转换为Blob并发送到WebSocket
          captureCanvas.toBlob(
            (blob) => {
              if (blob) {
                websocketController.sendData(blob);
              }
            },
            "image/jpeg",
            0.8
          );

          // 每隔一段时间捕获一帧
          setTimeout(captureAndSendFrame, 100); // 约每秒10帧
        };

        // 开始捕获和发送帧
        captureAndSendFrame();
      }
    };

    // 停止摄像头
    const stopCamera = () => {
      console.log("停止摄像头和检测...");

      // 先停止WebSocket检测
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
          videoElement.value.srcObject = null;
          videoElement.value.src = "";
        } catch (e) {
          console.error("清除视频源时出错:", e);
        }
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

      // 停止之前的摄像头和流媒体检测
      stopCamera();
      stopStreamDetection();

      // 重置检测统计
      detectionStats.resetDetectionStats();

      // 设置为视频模式（非摄像头、非流媒体）
      isCameraMode.value = false;
      isStreamMode.value = false;

      // 显示视频元素
      videoElement.value.style.display = "block";

      // 创建视频元素
      const video = videoElement.value;
      video.src = URL.createObjectURL(file);
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

      // 添加视频事件监听器
      video.addEventListener("timeupdate", videoController.updateVideoProgress);
      video.addEventListener("play", () => {
        videoController.isPlaying.value = true;
      });
      video.addEventListener("pause", () => {
        videoController.isPlaying.value = false;
      });
      video.addEventListener("volumechange", () => {
        videoController.volume.value = video.volume;
        videoController.isMuted.value = video.muted;
      });
    };

    // 视频文件检测函数
    const startVideoDetection = () => {
      if (!websocketController.isDetecting.value) {
        websocketController.startDetection();

        // 创建一个canvas用于捕获视频帧
        const captureCanvas = document.createElement("canvas");
        const captureCtx = captureCanvas.getContext("2d");
        const video = videoElement.value;

        // 设置捕获canvas的尺寸
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;

        // 定义捕获和发送帧的函数
        const captureAndSendFrame = () => {
          if (!websocketController.isDetecting.value || video.ended) {
            return; // 如果检测已停止或视频已结束，则退出
          }

          // 只在视频播放时捕获帧
          if (!video.paused) {
            // 捕获当前视频帧
            captureCtx.drawImage(
              video,
              0,
              0,
              captureCanvas.width,
              captureCanvas.height
            );

            // 将帧转换为Blob并发送到WebSocket
            captureCanvas.toBlob(
              (blob) => {
                websocketController.sendData(blob);
              },
              "image/jpeg",
              0.8
            );
          }

          // 每隔一段时间捕获一帧
          setTimeout(captureAndSendFrame, 100); // 约每秒10帧
        };

        // 开始捕获和发送帧
        video.addEventListener("play", () => {
          captureAndSendFrame();
        });

        // 如果视频已经在播放，立即开始捕获
        if (!video.paused) {
          captureAndSendFrame();
        }

        // 视频结束时停止检测
        video.addEventListener("ended", () => {
          websocketController.detectionStatus.value = "视频播放完毕";
          websocketController.isDetecting.value = false;
        });
      }
    };

    // 开始流媒体检测
    const startStreamDetection = async () => {
      console.log("开始流媒体检测:", streamUrl.value);

      // 停止其他检测模式
      stopCamera();

      // 重置检测统计
      detectionStats.resetDetectionStats();

      // 设置为流媒体模式
      isCameraMode.value = false;
      isStreamMode.value = true;
      isVideoActive.value = true;

      // 启动流媒体检测
      const result = await streamController.startStreamDetection(
        streamUrl.value
      );
      if (result) {
        websocketController.detectionStatus.value =
          streamController.streamStatus.value;
      } else {
        websocketController.detectionStatus.value =
          streamController.streamErrorMessage.value;
      }
    };

    // 停止流媒体检测
    const stopStreamDetection = () => {
      if (isStreamMode.value) {
        streamController.stopStreamDetection();
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
      } else {
        return websocketController.detectionStatus.value;
      }
    });

    onMounted(() => {
      chartController.initPieChart();

      // 初始化时设置 canvas 尺寸
      const resizeCanvas = () => {
        if (videoElement.value && canvasElement.value) {
          canvasElement.value.width = videoElement.value.videoWidth;
          canvasElement.value.height = videoElement.value.videoHeight;
        }
      };

      // 确保DOM元素已经准备好
      if (videoElement.value) {
        videoElement.value.addEventListener("loadedmetadata", resizeCanvas);
      }
      window.addEventListener("resize", resizeCanvas);

      // 添加键盘快捷键
      window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && isVideoActive.value && !isCameraMode.value) {
          videoController.togglePlay();
          e.preventDefault();
        }
      });
    });

    onUnmounted(() => {
      stopCamera();
      websocketController.stopDetection();
      window.removeEventListener("resize", resizeCanvas);

      // 移除视频事件监听器
      if (videoElement.value) {
        videoElement.value.removeEventListener(
          "timeupdate",
          videoController.updateVideoProgress
        );
      }

      // 移除键盘快捷键
      window.removeEventListener("keydown", null);
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
