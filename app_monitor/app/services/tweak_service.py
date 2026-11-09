import paramiko
import frida
import time
import os
import json
import plistlib
from config import Config

class TweakService:
    @staticmethod
    def _get_usb_device():
        """
        获取 USB 连接的 iOS 设备
        timeout 参数确保在未检测到设备时不会永久阻塞
        """
        try:
            # 等待并获取 USB 设备
            device = frida.get_usb_device(timeout=5)
            return device
        except Exception as e:
            raise Exception(f"No USB-connected iOS device detected. Check the cable connection: {e}")

    @staticmethod
    def _remove_tweak_files(ssh_client):
        """
        物理删除 iOS 设备上的插件文件和配置
        """
        commands = [
            "rm -f /Library/MobileSubstrate/DynamicLibraries/MonitorTweak.dylib",
            "rm -f /Library/MobileSubstrate/DynamicLibraries/MonitorTweak.plist",
            "rm -f /var/mobile/monitor_config.json",
            "rm -f /var/mobile/monitor_sdk_rules.json"
        ]
        for cmd in commands:
            ssh_client.exec_command(cmd)
        print("[*] 设备中旧插件文件已清理")

    @staticmethod
    def deploy_tweak(device_ip, bundle_id, server_ip):
        ssh = paramiko.SSHClient()
        sftp = None
        try:
            # 初始化 Frida USB 连接
            device = TweakService._get_usb_device()
            
            # 检查目标应用状态并强杀
            apps = device.enumerate_applications()
            target_app = next((app for app in apps if app.identifier == bundle_id), None)
            if target_app and target_app.pid != 0:
                print(f"[*] 检测到 {bundle_id} 正在运行 (PID: {target_app.pid})，正在强制退出...")
                try:
                    device.kill(target_app.pid)
                    time.sleep(1.0) # 给系统一点缓冲时间
                except Exception as e:
                    print(f"[!] 尝试终止进程失败 (可能是已退出): {e}")
                
            # 检查注入是所需依赖文件
            local_rules = os.path.join(os.getcwd(), 'app/frida_scripts/ios_sdk_rules.json')
            local_dylib = os.path.join(os.getcwd(), 'app/tweak_libs/MonitorTweak.dylib')
            
            if not os.path.exists(local_rules):
                return False, "Missing local file: app/frida_scripts/ios_sdk_rules.json"
            if not os.path.exists(local_dylib):
                return False, "Missing local file: app/tweak_libs/MonitorTweak.dylib. Build the Tweak first."

            # SSH 连接
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            # 通过 USB 映射（如 iproxy 2222 22）或直连 IP
            ssh.connect(device_ip, Config.SSH_PORT, Config.SSH_USER, Config.SSH_PASS, timeout=10)
            
            # 清理历史插件文件
            TweakService._remove_tweak_files(ssh)
            
            # 开始上传文件
            sftp = ssh.open_sftp()
            # 定义远程路径变量，方便后续校验
            remote_base_lib = "/Library/MobileSubstrate/DynamicLibraries"
            path_dylib = f"{remote_base_lib}/MonitorTweak.dylib"
            path_plist = f"{remote_base_lib}/MonitorTweak.plist"
            path_rules = "/var/mobile/monitor_sdk_rules.json"
            path_config = "/var/mobile/monitor_config.json"
            
            # 上传 Dylib
            sftp.put(local_dylib, path_dylib)
            
            # 上传 Plist 文件
            plist_data = {"Filter": {"Bundles": [bundle_id]}}
            with open('temp.plist', 'wb') as f:
                plistlib.dump(plist_data, f)
            sftp.put('temp.plist', path_plist)
            
            # 上传 SDK 规则文件
            sftp.put(local_rules, path_rules)
            
            # 上传 配置文件
            config_data = {"server_url": f"http://{server_ip}:{Config.SERVER_PORT}/api/report_log"}
            with open('temp_config.json', 'w') as f:
                json.dump(config_data, f)
            sftp.put('temp_config.json', path_config)
            
            # 关闭 SFTP，准备执行校验命令
            sftp.close()
            sftp = None 

            # 文件传输校验逻辑，检查文件是否存在
            check_cmd = f"test -s {path_dylib} && test -s {path_plist} && test -s {path_rules} && test -s {path_config}"
            stdin, stdout, stderr = ssh.exec_command(check_cmd)
            exit_status = stdout.channel.recv_exit_status()

            if exit_status != 0:
                raise Exception("File-transfer validation failed. Check device storage and write permissions.")
            print("[*] 插件文件校验通过，准备启动应用...")

            # 通过 Frida 启动应用，使注入的dylib文件生效
            pid = device.spawn([bundle_id])
            device.resume(pid)
            
            return True, f"Tweak deployed and validated; app started automatically (PID: {pid})"

        except Exception as e:
            print(f"[Deploy Error] {e}")
            return False, f"Deployment failed: {str(e)}"
        finally:
            if sftp: sftp.close()
            ssh.close()
            # 清理本地临时文件
            for f in ['temp.plist', 'temp_config.json']:
                if os.path.exists(f): os.remove(f)

    @staticmethod
    def cleanup_tweak(device_ip, bundle_id):
        """清除注入并强杀进程"""
        print(f"[*] 正在清理环境并停止应用: {bundle_id} ")
        try:
            # 连接SSH 删除文件
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(device_ip, Config.SSH_PORT, Config.SSH_USER, Config.SSH_PASS, timeout=5)
            
            # 删除相关文件
            cmd = "rm -f /Library/MobileSubstrate/DynamicLibraries/MonitorTweak.dylib " \
                  "/Library/MobileSubstrate/DynamicLibraries/MonitorTweak.plist " \
                  "/var/mobile/monitor_config.json " \
                  "/var/mobile/monitor_sdk_rules.json"
            ssh.exec_command(cmd)
            ssh.close()

            # 通过Frida USB 强杀目标应用
            device = TweakService._get_usb_device()
            try:
                apps = device.enumerate_applications()
                target = next((app for app in apps if app.identifier == bundle_id), None)
                if target and target.pid != 0:
                    device.kill(target.pid)
            except Exception as kill_err:
                print(f"[!] 尝试关闭应用时出错 (可能已关闭): {kill_err}")

            return True, f"Tweak removed and app closed: {bundle_id}"
        except Exception as e:
            return False, f"Cleanup failed: {str(e)}"
