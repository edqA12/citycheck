import { ref } from 'vue'

// 视频控制模块
export function createVideoController(videoElement, progressContainer) {
    const isPlaying = ref(false);
    const isMuted = ref(false);
    const volume = ref(1);
    const currentTime = ref(0);
    const duration = ref(0);
    const videoProgress = ref(0);

    // 格式化时间
    const formatTime = (seconds) => {
        if (isNaN(seconds) || seconds === Infinity) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // 更新视频进度
    const updateVideoProgress = () => {
        if (!videoElement.value) return;
        
        const video = videoElement.value;
        currentTime.value = video.currentTime;
        duration.value = video.duration;
        
        if (duration.value > 0) {
            videoProgress.value = (currentTime.value / duration.value) * 100;
        }
    };

    // 切换播放/暂停
    const togglePlay = () => {
        const video = videoElement.value;
        if (!video) return;
        
        if (video.paused) {
            video.play();
            isPlaying.value = true;
        } else {
            video.pause();
            isPlaying.value = false;
        }
    };

    // 切换静音
    const toggleMute = () => {
        const video = videoElement.value;
        if (!video) return;
        
        video.muted = !video.muted;
        isMuted.value = video.muted;
    };

    // 更新音量
    const updateVolume = () => {
        const video = videoElement.value;
        if (!video) return;
        
        video.volume = volume.value;
        if (volume.value > 0 && video.muted) {
            video.muted = false;
            isMuted.value = false;
        }
    };

    // 跳转到指定位置
    const seekVideo = (event) => {
        if (!videoElement.value || !progressContainer.value) return;
        
        const video = videoElement.value;
        const container = progressContainer.value;
        const rect = container.getBoundingClientRect();
        const pos = (event.clientX - rect.left) / rect.width;
        
        video.currentTime = pos * video.duration;
    };

    // 切换全屏
    const toggleFullscreen = () => {
        const videoContainer = document.querySelector('.video-container');
        if (!videoContainer) return;
        
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(err => {
                console.error(`全屏错误: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    };

    return {
        isPlaying,
        isMuted,
        volume,
        currentTime,
        duration,
        videoProgress,
        formatTime,
        updateVideoProgress,
        togglePlay,
        toggleMute,
        updateVolume,
        seekVideo,
        toggleFullscreen
    };
} 