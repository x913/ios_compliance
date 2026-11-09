import frida
from app.utils.image_helper import bytes_to_base64
from config import Config

class IOSDeviceService:
    @staticmethod
    def get_device():
        try:
            # 尝试获取 USB 设备
            # 增加 timeout 防止连接卡死
            return frida.get_usb_device(timeout=5)
        except Exception as e:
            print(f"[ERROR] Failed to get USB device: {e}")
            raise ConnectionError(f"Unable to connect to a USB device: {str(e)}")

    @staticmethod
    def get_installed_apps():
        try:
            print("[-] Connecting to device...")
            device = IOSDeviceService.get_device()
            print(f"[-] Connected to device: {device.name} (ID: {device.id})")

            print("[-] Enumerating applications; this may take a few seconds...")
            # 注意：scope='full' 会读取图标，速度较慢
            raw_apps = device.enumerate_applications(scope='full')
            print(f"[-] Frida found {len(raw_apps)} processes/applications")

            clean_apps = []
            
            for app in raw_apps:
                # 获取路径，如果获取失败默认为空字符串
                path = app.parameters.get('path', '')
                name = app.name

                # 过滤逻辑
                is_user_app = any(path.startswith(prefix) for prefix in Config.APP_PATH_PREFIXES)
                
                if is_user_app:
                    #print(f"[+] 匹配到用户应用: {name}")
                    
                    # 处理图标
                    icon_b64 = None
                    icons = app.parameters.get('icons', [])
                    if icons:
                        try:
                            icon_blob = icons[-1].get('image')
                            icon_b64 = bytes_to_base64(icon_blob)
                        except Exception as e:
                            print(f"[!] Failed to process icon for {name}: {e}")

                    clean_apps.append({
                        "name": app.name,
                        "bundle_id": app.identifier,
                        "version": app.parameters.get('version', 'Unknown'),
                        "path": path,
                        "icon": icon_b64
                    })
            
            print(f"[-] User applications after filtering: {len(clean_apps)}")
            
            # 按名称排序
            clean_apps.sort(key=lambda x: x['name'])
            return clean_apps

        except frida.ServerNotRunningError:
            print("[ERROR] frida-server is not running")
            raise RuntimeError("Frida Server is not running on the iOS device")
        except frida.InvalidArgumentError:
            print("[ERROR] No USB device found")
            raise RuntimeError("No device found. Check the USB connection.")
        except Exception as e:
            print(f"[ERROR] Unexpected error: {str(e)}")
            raise RuntimeError(f"Internal Frida error: {str(e)}")
