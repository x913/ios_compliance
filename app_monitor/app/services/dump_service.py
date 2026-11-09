import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app import socketio


class DumpService:
    """Optional adapter for the locally installed iDump command-line tool."""

    _jobs = {}
    _lock = threading.Lock()

    @staticmethod
    def artifact_dir():
        return Path(__file__).resolve().parents[2] / "artifacts"

    @staticmethod
    def _idump_path():
        configured_path = os.environ.get("IOS_COMPLIANCE_IDUMP_BIN", "idump")
        return shutil.which(configured_path)

    @classmethod
    def tool_status(cls):
        executable = cls._idump_path()
        return {
            "available": executable is not None,
            "path": executable or "",
            "message": "iDump is ready" if executable else "Install iDump and add it to PATH to enable IPA export"
        }

    @classmethod
    def start_dump(cls, bundle_id, app_name=""):
        executable = cls._idump_path()
        if not executable:
            raise RuntimeError("iDump was not found. Install it or set IOS_COMPLIANCE_IDUMP_BIN to its executable path.")

        cls.artifact_dir().mkdir(parents=True, exist_ok=True)
        job_id = uuid.uuid4().hex
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", app_name or bundle_id).strip("._") or "app"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        output_name = f"{safe_name}-{timestamp}.ipa"
        job = {
            "job_id": job_id,
            "bundle_id": bundle_id,
            "state": "queued",
            "message": "Dump queued",
            "output_name": output_name,
            "error": "",
            "logs": []
        }

        with cls._lock:
            cls._jobs[job_id] = job

        worker = threading.Thread(
            target=cls._run_dump,
            args=(job_id, executable, bundle_id, output_name),
            daemon=True,
        )
        worker.start()
        return cls._public_job(job)

    @classmethod
    def _run_dump(cls, job_id, executable, bundle_id, output_name):
        command = [executable, "--output", output_name, bundle_id]
        cls._update_job(job_id, state="running", message="Connecting to the iPhone and dumping the decrypted IPA")

        try:
            process = subprocess.Popen(
                command,
                cwd=cls.artifact_dir(),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in iter(process.stdout.readline, ""):
                cls._update_job(job_id, message=line.strip(), append_log=line.rstrip())
            return_code = process.wait()

            output_path = cls.artifact_dir() / output_name
            if return_code == 0 and output_path.is_file():
                cls._update_job(job_id, state="completed", message="Decrypted IPA is ready")
            elif return_code == 0:
                cls._update_job(job_id, state="failed", message="iDump finished but no IPA was created", error="Expected output file was not found")
            else:
                cls._update_job(job_id, state="failed", message="IPA dump failed", error=f"iDump exited with status {return_code}")
        except Exception as error:
            cls._update_job(job_id, state="failed", message="IPA dump failed", error=str(error))

    @classmethod
    def _update_job(cls, job_id, state=None, message=None, error=None, append_log=None):
        with cls._lock:
            job = cls._jobs[job_id]
            if state:
                job["state"] = state
            if message:
                job["message"] = message
            if error:
                job["error"] = error
            if append_log:
                job["logs"] = (job["logs"] + [append_log])[-200:]
            payload = cls._public_job(job)

        socketio.emit("dump_status", payload)

    @staticmethod
    def _public_job(job):
        return {
            "job_id": job["job_id"],
            "bundle_id": job["bundle_id"],
            "state": job["state"],
            "message": job["message"],
            "output_name": job["output_name"] if job["state"] == "completed" else "",
            "error": job["error"],
            "logs": job["logs"][-20:]
        }
