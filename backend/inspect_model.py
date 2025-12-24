import torch
import pprint

def inspect_pt_model(model_path):
    """
    加载并检查PyTorch模型文件的内容
    """
    print(f"正在加载模型: {model_path}")
    
    # 加载模型
    model_data = torch.load(model_path, map_location=torch.device('cpu'))
    
    # 打印模型的顶级键
    print("\n模型的顶级键:")
    for key in model_data.keys():
        print(f"- {key}")
    
    # 如果模型是字典类型，打印更详细的信息
    if isinstance(model_data, dict):
        # 打印模型结构
        if 'model' in model_data:
            print("\n模型结构:")
            if hasattr(model_data['model'], 'names'):
                print(f"类别名称: {model_data['model'].names}")
            
            # 打印模型的参数数量
            if hasattr(model_data['model'], 'parameters'):
                total_params = sum(p.numel() for p in model_data['model'].parameters())
                print(f"参数总数: {total_params:,}")
        
        # 打印训练配置
        if 'train_args' in model_data:
            print("\n训练配置:")
            pprint.pprint(model_data['train_args'])
        
        # 打印优化器信息
        if 'optimizer' in model_data:
            print("\n优化器信息:")
            print(f"类型: {type(model_data['optimizer'])}")
    
    # 如果是YOLO模型，尝试打印更多特定信息
    try:
        from ultralytics.engine.model import Model
        if isinstance(model_data, Model) or (isinstance(model_data, dict) and 'model' in model_data and isinstance(model_data['model'], Model)):
            model = model_data if isinstance(model_data, Model) else model_data['model']
            print("\nYOLO模型信息:")
            print(f"任务类型: {model.task if hasattr(model, 'task') else '未知'}")
            print(f"类别数量: {len(model.names) if hasattr(model, 'names') else '未知'}")
            print(f"类别名称: {model.names if hasattr(model, 'names') else '未知'}")
    except ImportError:
        print("未安装ultralytics库，无法提取YOLO特定信息")
    except Exception as e:
        print(f"提取YOLO信息时出错: {e}")

if __name__ == "__main__":
    model_path = "best.pt"  # 模型文件路径
    inspect_pt_model(model_path) 