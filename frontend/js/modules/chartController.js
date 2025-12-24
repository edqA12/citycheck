// 图表控制模块
export function createChartController(pieChartElement) {
    let pieChartInstance = null;

    // 初始化饼图
    const initPieChart = () => {
        if (!pieChartElement.value) return;
        
        const ctx = pieChartElement.value.getContext('2d');
        
        if (pieChartInstance) {
            pieChartInstance.destroy();
        }
        
        pieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#e74c3c',  // 红色 - 井盖破损
                        '#e67e22',  // 橙色 - 井圈问题
                        '#2ecc71',  // 绿色 - 井盖完好
                        '#f1c40f',  // 黄色 - 井盖缺失
                        '#95a5a6',  // 灰色 - 井盖未盖
                        '#3498db',  // 蓝色 - 法兰
                        '#2980b9',  // 深蓝色 - 管道
                        '#1abc9c',  // 青色 - 挖掘机
                        '#16a085',  // 深青色 - 卡车
                        '#27ae60',  // 深绿色 - 压路机
                        '#f39c12',  // 橙色 - 吊车
                        '#d35400',  // 深橙色 - 塔吊
                        '#c0392b',  // 深红色 - 装载机
                        '#e74c3c',  // 红色 - 搅拌车
                        '#9b59b6',  // 紫色 - 挖掘装载机
                        '#8e44ad',  // 深紫色 - 推土机
                        '#2c3e50'   // 深灰色 - 平地机
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 11
                            },
                            padding: 10,
                            boxWidth: 12,
                            boxHeight: 12
                        },
                        display: true,
                        maxHeight: 80
                    },
                    tooltip: {
                        bodyFont: {
                            size: 12
                        },
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value}次 (${percentage}%)`;
                            }
                        }
                    }
                },
                cutout: '55%',
                animation: {
                    animateScale: true,
                    animateRotate: true,
                    duration: 800
                },
                layout: {
                    padding: {
                        top: 5,
                        bottom: 5,
                        left: 5,
                        right: 5
                    }
                }
            }
        });
    };

    // 更新饼图数据
    const updatePieChart = (data) => {
        if (!pieChartInstance) {
            initPieChart();
        }
        
        if (!pieChartInstance) return;
        
        // 直接使用所有检测类别的数据
        const labels = Object.keys(data);
        const values = Object.values(data);
        
        pieChartInstance.data.labels = labels;
        pieChartInstance.data.datasets[0].data = values;
        
        pieChartInstance.update();
    };

    return {
        initPieChart,
        updatePieChart
    };
} 