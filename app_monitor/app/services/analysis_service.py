import logging
import time
from pathlib import Path

import frida


logger = logging.getLogger(__name__)


class AppAnalysisService:
    """Collect safe runtime and bundle metadata without extracting an IPA."""

    @staticmethod
    def _load_agent_source():
        scripts_dir = Path(__file__).resolve().parent.parent / "frida_scripts"
        entrypoint = scripts_dir / "app_analysis.js"
        try:
            return frida.Compiler().build(str(entrypoint))
        except Exception as error:
            logger.error("App analysis agent build failed: %s", error)
            raise RuntimeError(f"Could not build the app analysis agent: {error}") from error

    @staticmethod
    def _target_process(device, bundle_id):
        try:
            running_app = next(
                (
                    app for app in device.enumerate_applications(scope="minimal")
                    if app.identifier == bundle_id and app.pid != 0
                ),
                None,
            )
            if running_app:
                return running_app.pid, False
        except Exception as error:
            logger.warning("Could not enumerate running applications: %s", error)

        try:
            return device.spawn([bundle_id]), True
        except Exception as error:
            raise RuntimeError(
                f"Could not start {bundle_id}. Ensure it is installed and the device is unlocked."
            ) from error

    @classmethod
    def analyze_app(cls, bundle_id):
        session = None
        script = None
        spawned = False
        pid = None
        resumed = False

        try:
            device = frida.get_usb_device(timeout=5)
            pid, spawned = cls._target_process(device, bundle_id)
            session = device.attach(pid)
            script = session.create_script(cls._load_agent_source())
            script.load()

            if spawned:
                device.resume(pid)
                resumed = True

            # Let app-owned frameworks finish their initial load before we enumerate them.
            time.sleep(1)
            return script.exports_sync.inspect()
        except frida.ServerNotRunningError as error:
            raise RuntimeError("Frida Server is not running on the iPhone") from error
        except frida.InvalidArgumentError as error:
            raise RuntimeError("No USB iPhone was found") from error
        finally:
            if spawned and pid and not resumed:
                try:
                    device.resume(pid)
                except Exception:
                    pass
            if script:
                try:
                    script.unload()
                except Exception:
                    pass
            if session:
                try:
                    session.detach()
                except Exception:
                    pass
