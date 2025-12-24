import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

// 检测统计模块
export function createDetectionStats() {
    const detectionCount = ref(0);
    const detectionClasses = ref({});
    const hasShownWarning = ref(false);
    const hazards = ref({});
    // 添加已显示提示的物体类型集合
    const shownAlerts = ref(new Set());

    // 计算属性：是否存在隐患
    const hasHazards = computed(() => Object.keys(hazards.value).length > 0);

    // 计算属性：隐患总数（物体种类数）
    const hazardCount = computed(() => {
        return Object.keys(hazards.value).length;
    });

    // 重置检测统计
    const resetDetectionStats = () => {
        detectionCount.value = 0;
        detectionClasses.value = {};
        hasShownWarning.value = false;
        hazards.value = {};
        // 重置已显示提示的集合
        shownAlerts.value.clear();
    };

    // 更新检测统计
    const updateDetectionStats = (detections) => {
        if (!detections || detections.length === 0) return;
        
        // 更新总检测数
        detectionCount.value += detections.length;
        
        // 临时存储本次检测的隐患类型
        const currentHazardTypes = new Set();
        
        // 更新各类别检测数和隐患信息
        detections.forEach(detection => {
            const className = detection.class_name || `类别 ${detection.class}`;
            if (!detectionClasses.value[className]) {
                detectionClasses.value[className] = 0;
            }
            detectionClasses.value[className]++;

            // 根据类别判断隐患类型
            let hazardType = '';
            if (detection.class >= 0 && detection.class <= 4) {
                // 井盖相关隐患
                if (detection.class === 0) { // 井盖破损
                    hazardType = '井盖破损';
                } else if (detection.class === 1) { // 井圈问题
                    hazardType = '井圈问题';
                } else if (detection.class === 3) { // 井盖缺失
                    hazardType = '井盖缺失';
                } else if (detection.class === 4) { // 井盖未盖
                    hazardType = '井盖未盖';
                }
            } else if (detection.class >= 7 && detection.class <= 16) {
                // 工程车辆相关隐患
                hazardType = `工程车辆-${className}`;
            }

            // 如果是有效的隐患类型，添加到当前检测的隐患集合中
            if (hazardType) {
                currentHazardTypes.add(hazardType);
            }
        });

        // 更新隐患统计（只记录种类，不记录数量）
        currentHazardTypes.forEach(type => {
            // 设置为1表示存在此类型，而不是累加数量
            hazards.value[type] = 1;
            
            // 只有当该类型的提示未显示过时才显示提示
            if (!shownAlerts.value.has(type)) {
                let message = '';
                if (type.startsWith('工程车辆-')) {
                    message = `检测到${type.replace('工程车辆-', '')}，请注意检测区域安全！`;
                } else {
                    const hazardMessages = {
                        '井盖破损': '发现井盖破损，请及时维修！',
                        '井盖缺失': '警告：井盖缺失，存在重大安全隐患！',
                        '井盖未盖': '井盖未盖，请及时处理！',
                        '井圈问题': '发现井圈问题，需要检查！'
                    };
                    message = hazardMessages[type] || `发现${type}隐患，请注意安全！`;
                }

                ElMessage({
                    message: message,
                    type: type.includes('缺失') ? 'error' : 'warning',
                    duration: 5000,
                    showClose: true
                });
                
                // 将该类型添加到已显示提示的集合中
                shownAlerts.value.add(type);
            }
        });
    };

    // 获取隐患图标
    const getHazardIcon = (type) => {
        if (type.startsWith('工程车辆-')) {
            return 'fa-truck';
        }
        switch (type) {
            case '井盖破损': return 'fa-exclamation-circle';
            case '井圈问题': return 'fa-circle-xmark';
            case '井盖缺失': return 'fa-triangle-exclamation';
            case '井盖未盖': return 'fa-shield-xmark';
            default: return 'fa-exclamation-triangle';
        }
    };

    // 获取隐患徽章样式
    const getHazardBadgeClass = (type) => {
        if (type.startsWith('工程车辆-')) {
            return 'bg-warning text-dark';
        }
        switch (type) {
            case '井盖缺失': return 'bg-danger';
            case '井盖破损': return 'bg-warning text-dark';
            case '井盖未盖': return 'bg-info';
            default: return 'bg-secondary';
        }
    };

    // 获取隐患进度条样式
    const getHazardProgressClass = (type) => {
        if (type.startsWith('工程车辆-')) {
            return 'bg-warning';
        }
        switch (type) {
            case '井盖缺失': return 'bg-danger';
            case '井盖破损': return 'bg-warning';
            case '井盖未盖': return 'bg-info';
            default: return 'bg-secondary';
        }
    };

    // 获取隐患百分比（固定为100%，因为只显示种类不显示数量）
    const getHazardPercentage = () => {
        return 100;
    };

    // 获取检测结果中数量最多的类别
    const getMaxDetectionClass = () => {
        let maxClass = '';
        let maxCount = 0;
        
        for (const [className, count] of Object.entries(detectionClasses.value)) {
            if (count > maxCount) {
                maxCount = count;
                maxClass = className;
            }
        }
        
        return { className: maxClass, count: maxCount };
    };

    // 获取特定类别范围的检测结果
    const getCategoryDetections = (startClass, endClass) => {
        const result = {};
        
        for (const [className, count] of Object.entries(detectionClasses.value)) {
            // 提取类别ID
            const classMatch = className.match(/^.*?(\d+)$/);
            if (classMatch) {
                const classId = parseInt(classMatch[1]);
                if (classId >= startClass && classId <= endClass) {
                    result[className] = count;
                }
            } else if (className.includes('类别')) {
                // 处理"类别 X"格式
                const classId = parseInt(className.split(' ')[1]);
                if (!isNaN(classId) && classId >= startClass && classId <= endClass) {
                    result[className] = count;
                }
            }
        }
        
        return result;
    };

    // 检查是否有特定类别范围的检测结果
    const hasCategoryDetections = (startClass, endClass) => {
        return Object.keys(getCategoryDetections(startClass, endClass)).length > 0;
    };

    // 获取其他类别的检测结果（不在已知类别范围内的）
    const getOtherDetections = () => {
        const result = {};
        const knownClassIds = Array.from({ length: 17 }, (_, i) => i); // 0-16
        
        for (const [className, count] of Object.entries(detectionClasses.value)) {
            let isKnown = false;
            
            // 提取类别ID
            const classMatch = className.match(/^.*?(\d+)$/);
            if (classMatch) {
                const classId = parseInt(classMatch[1]);
                if (knownClassIds.includes(classId)) {
                    isKnown = true;
                }
            } else if (className.includes('类别')) {
                // 处理"类别 X"格式
                const classId = parseInt(className.split(' ')[1]);
                if (!isNaN(classId) && knownClassIds.includes(classId)) {
                    isKnown = true;
                }
            }
            
            if (!isKnown) {
                result[className] = count;
            }
        }
        
        return result;
    };

    // 检查是否有其他类别的检测结果
    const hasOtherDetections = () => {
        return Object.keys(getOtherDetections()).length > 0;
    };

    // 计算百分比（相对于最大检测数）
    const getPercentage = (count) => {
        const maxCount = getMaxDetectionClass().count;
        return maxCount > 0 ? (count / maxCount) * 100 : 0;
    };

    return {
        detectionCount,
        detectionClasses,
        hazards,
        hasHazards,
        hazardCount,
        resetDetectionStats,
        updateDetectionStats,
        getHazardIcon,
        getHazardBadgeClass,
        getHazardProgressClass,
        getHazardPercentage,
        getMaxDetectionClass,
        getCategoryDetections,
        hasCategoryDetections,
        getOtherDetections,
        hasOtherDetections,
        getPercentage
    };
} 