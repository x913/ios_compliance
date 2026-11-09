from pathlib import Path

from flask import Blueprint, jsonify, request, send_from_directory
from app import socketio
from app.services.analysis_service import AppAnalysisService
from app.services.dump_service import DumpService
from app.services.frida_service import IOSDeviceService
from app.services.monitor_service import MonitorService
from app.services.tweak_service import TweakService


api_bp = Blueprint('api', __name__, url_prefix='/api')


@api_bp.route('/apps', methods=['GET'])
def get_apps():
    try:
        apps = IOSDeviceService.get_installed_apps()
        return jsonify({"status": "success", "data": apps})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _require_idle_monitor():
    if MonitorService.session:
        return jsonify({
            "status": "error",
            "message": "Stop the active monitoring session before starting app analysis or an IPA dump."
        }), 409
    return None


@api_bp.route('/analyze_app', methods=['POST'])
def analyze_app():
    idle_monitor_error = _require_idle_monitor()
    if idle_monitor_error:
        return idle_monitor_error

    data = request.get_json(silent=True) or {}
    bundle_id = data.get('bundle_id')
    if not bundle_id:
        return jsonify({"status": "error", "message": "Bundle ID is required"}), 400

    try:
        result = AppAnalysisService.analyze_app(bundle_id)
        return jsonify({"status": "success", "data": result})
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 500


@api_bp.route('/dump_tool_status', methods=['GET'])
def dump_tool_status():
    return jsonify({"status": "success", "data": DumpService.tool_status()})


@api_bp.route('/dump_ipa', methods=['POST'])
def dump_ipa():
    idle_monitor_error = _require_idle_monitor()
    if idle_monitor_error:
        return idle_monitor_error

    data = request.get_json(silent=True) or {}
    bundle_id = data.get('bundle_id')
    if not bundle_id:
        return jsonify({"status": "error", "message": "Bundle ID is required"}), 400

    try:
        job = DumpService.start_dump(bundle_id, data.get('app_name', ''))
        return jsonify({"status": "success", "data": job})
    except Exception as error:
        return jsonify({"status": "error", "message": str(error)}), 500


@api_bp.route('/artifacts/<path:filename>', methods=['GET'])
def download_artifact(filename):
    if Path(filename).name != filename or not filename.endswith('.ipa'):
        return jsonify({"status": "error", "message": "Artifact not found"}), 404
    return send_from_directory(str(DumpService.artifact_dir()), filename, as_attachment=True)

@api_bp.route('/start_monitor', methods=['POST'])
def start_monitor():
    # 这里使用了 request 对象，所以必须在文件开头导入它
    data = request.json
    
    # 增加健壮性检查，防止 data 为 None
    if not data:
        return jsonify({"status": "error", "message": "Invalid request data"}), 400

    bundle_id = data.get('bundle_id')
    
    if not bundle_id:
        return jsonify({"status": "error", "message": "Bundle ID is required"}), 400

    # 调用监控服务
    success, msg = MonitorService.start_monitoring(bundle_id)
    
    if success:
        return jsonify({"status": "success", "message": msg})
    else:
        return jsonify({"status": "error", "message": msg}), 500


# === 新增：停止监控接口 ===
@api_bp.route('/stop_monitor', methods=['POST'])
def stop_monitor():
    success, msg = MonitorService.stop_monitoring()
    return jsonify({"status": "success", "message": msg})

# === 接收 Tweak 上报的日志 ===
@api_bp.route('/report_log', methods=['POST'])
def report_log():
    data = request.json
    if not data:
        return "error", 400
        
    msg_type = data.get('type')
    
    # 转发给前端 (复用现有的 Socket 事件)
    if msg_type == 'network':
        socketio.emit('network_log', data)
    elif msg_type == 'network_response':
        socketio.emit('network_response_log', data)
    elif msg_type == 'file':
        socketio.emit('file_log', data)
    elif msg_type == 'info':
        socketio.emit('info_log', data)
    elif msg_type == 'sdk':
        socketio.emit('sdk_log', data)   
    elif msg_type == 'heart':
        socketio.emit('heart_log', data)   
    elif msg_type == 'sys_log':
        socketio.emit('sys_log', data)      
    return "ok", 200

# === 启动监控 (Tweak 模式) ===
@api_bp.route('/start_tweak_monitor', methods=['POST'])
def start_tweak_monitor():
    data = request.json
    bundle_id = data.get('bundle_id')
    device_ip = data.get('device_ip') # 手机IP
    server_ip = data.get('server_ip') # 电脑IP
    
    if not all([bundle_id, device_ip, server_ip]):
        return jsonify({"status": "error", "message": "Both IP addresses are required"}), 400
        
    success, msg = TweakService.deploy_tweak(device_ip, bundle_id, server_ip)
    
    if success:
        return jsonify({"status": "success", "message": msg})
    else:
        return jsonify({"status": "error", "message": msg}), 500

@api_bp.route('/stop_tweak_monitor', methods=['POST'])
def stop_tweak_monitor():
    data = request.json
    device_ip = data.get('device_ip')
    bundle_id = data.get('bundle_id')

    print(device_ip, bundle_id)
    
    success, msg = TweakService.cleanup_tweak(device_ip, bundle_id)
    return jsonify({"status": "success", "message": msg})
