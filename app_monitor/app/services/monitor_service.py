import frida
import os
import time
import logging
from pathlib import Path
from app import socketio

# 日志
logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

class MonitorService:
    # 类属性存储状态
    session = None
    script = None
    pid = None
    bundle_id = None
    spawned = False

    @staticmethod
    def _load_js_source():
        """Bundle the Frida agent and its explicit Objective-C bridge dependency."""
        scripts_dir = Path(__file__).resolve().parent.parent / 'frida_scripts'
        entrypoint = scripts_dir / 'loader.js'
        try:
            if not entrypoint.is_file():
                raise FileNotFoundError(f"Agent entrypoint not found: {entrypoint}")
            return frida.Compiler().build(str(entrypoint))
        except Exception as e:
            logger.error("Frida agent build failed: %s", e)
            return None

    @classmethod
    def _get_process(cls, device, bundle_id):
        """Return a PID and whether this service spawned it."""
        try:
            # Keep the spawned process suspended. The caller attaches, loads
            # all hooks, and only then resumes it so early app activity is not
            # missed.
            pid = device.spawn([bundle_id])
            logger.info(f"App spawned and suspended, PID: {pid}")
            return pid, True
        except (frida.NotSupportedError, frida.ServerNotRunningError):
            logger.info("Spawn is unavailable; looking for an already running app...")
        except Exception as e:
            logger.warning(f"Spawn attempt failed: {e}")

        try:
            app = next(
                (
                    candidate
                    for candidate in device.enumerate_applications()
                    if candidate.identifier == bundle_id and candidate.pid != 0
                ),
                None,
            )
            if app:
                logger.info(f"Found a running app, PID: {app.pid}")
                return app.pid, False
        except Exception as e:
            logger.warning(f"Failed to find a running app: {e}")

        raise Exception(f"Could not locate {bundle_id}. Ensure it is installed and the device is unlocked.")

    @classmethod
    def _attach_with_retry(cls, device, target, max_retries=3):
        """带重试机制的附加进程"""
        for i in range(max_retries):
            try:
                session = device.attach(target)
                logger.info(f"Attached to process: {target}")
                return session
            except Exception as e:
                if i == max_retries - 1: raise e
                logger.warning(f"Attach failed ({i + 1}/{max_retries}); retrying in 1 second: {e}")
                time.sleep(1)

    @classmethod
    def _wait_for_hook_setup(cls, timeout_seconds):
        """Wait until the injected loader confirms that hook setup completed."""
        deadline = time.monotonic() + timeout_seconds
        last_status = None

        while time.monotonic() < deadline:
            last_status = cls.script.exports_sync.check_status()
            if last_status.get("hooks_loaded"):
                logger.info("Frida hooks ready: %s", last_status.get("modules", {}))
                return last_status
            time.sleep(0.1)

        return None

    @staticmethod
    def _require_monitoring_hooks(status):
        """Reject a session where the loader ran but no monitor hooks attached."""
        required_modules = ("Network Monitor", "File Monitor", "Privacy Monitor")
        modules = status.get("modules", {})
        unavailable = [
            name
            for name in required_modules
            if not modules.get(name, {}).get("started")
            or not modules.get(name, {}).get("hooks", 0)
        ]
        if unavailable:
            raise RuntimeError(
                "Frida loader completed without active hooks in: "
                + ", ".join(unavailable)
                + f" (status: {status})"
            )

    @classmethod
    def _on_message(cls, message, data):
        """Frida消息回调处理"""
        if message['type'] == 'send':
            payload = message['payload']
            msg_type = payload.get('type')
            # 消息类型映射
            event_map = {
                'network': 'network_log',
                'file': 'file_log',
                'info': 'info_log',
                'sdk': 'sdk_log',
                'heart': 'heart_log',
                'sys_log': 'sys_log'
            }
            if msg_type in event_map:
                socketio.emit(event_map[msg_type], payload)
        elif message['type'] == 'error':
            err_msg = message.get('description',str(message))
            if 'destroyed' not in str(err_msg):
                logger.error(f"Script Error: {err_msg}")
                socketio.emit('sys_log', {'msg': f"Script error: {err_msg}"})

    @classmethod
    def start_monitoring(cls, bundle_id):
        """启动监控流程"""
        cls.stop_monitoring() # 先清理旧会话
        cls.bundle_id = bundle_id

        try:
            device = frida.get_usb_device()
            logger.info(f"Preparing to monitor: {bundle_id}")

            # 获取PID（优先 Spawn，否则附加到已运行的应用）
            cls.pid, cls.spawned = cls._get_process(device, bundle_id)

            # 附加进程
            cls.session = cls._attach_with_retry(device, cls.pid)
            
            # 加载脚本
            js_source = cls._load_js_source()
            if not js_source: raise Exception("No JavaScript source was loaded")
            
            cls.script = cls.session.create_script(js_source)
            cls.script.on('message', cls._on_message)
            cls.script.load()

            # On a normal iOS app the ObjC runtime is ready here, so hooks are
            # installed before resume. Keep a fallback for unusually early
            # spawn points where ObjC becomes available only after resume.
            hook_status = cls._wait_for_hook_setup(timeout_seconds=1)

            # Resume only processes spawned by this service. Existing app
            # processes were already running when hooks were loaded.
            if cls.spawned:
                device.resume(cls.pid)

            if hook_status is None:
                hook_status = cls._wait_for_hook_setup(timeout_seconds=5)
            if hook_status is None:
                raise RuntimeError("Frida loader did not confirm hook installation within 5 seconds")
            cls._require_monitoring_hooks(hook_status)

            msg = f"Monitoring started successfully (PID: {cls.pid})"
            socketio.emit('sys_log', {'msg': msg})
            return True, "Monitoring started"

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Start Error: {error_msg}")
            
            # 简化的错误提示逻辑
            tips = "Unknown error"
            if "PermissionDenied" in error_msg: tips = "Permission denied: check code signing and device trust"
            elif "process not found" in error_msg.lower(): tips = "Process not found: start the app manually"
            elif "server" in error_msg.lower(): tips = "Connection failed: check the Frida Server version"
            
            socketio.emit('sys_log', {'msg': f"Failed to start: {tips}\nDetails: {error_msg}"})
            return False, error_msg

    @classmethod
    def stop_monitoring(cls):
        """停止监控并清理资源"""
        msg = "No active monitoring session"
        try:
            if cls.script:
                try: cls.script.unload()
                except: pass
            
            if cls.session:
                try: cls.session.detach()
                except: pass
                
            # Only stop a process we started ourselves. A pre-existing app is
            # left running when monitoring ends.
            if cls.pid and cls.spawned:
                try:
                    frida.get_usb_device().kill(cls.pid)
                    msg = f"Monitoring stopped; process terminated: {cls.bundle_id}"
                except:
                    msg = "Monitoring stopped (the process already ended or is unavailable)"
            
            socketio.emit('sys_log', {'msg': msg})

        except Exception as e:
            msg = f"Error while stopping monitoring: {e}"
            logger.error(msg)
        finally:
            cls.session = None
            cls.script = None
            cls.pid = None
            cls.bundle_id = None
            cls.spawned = False
            
        return True, msg
