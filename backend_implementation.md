# Hybrid Local AI Hub — Offline Automation Engine

## 1. Build Prompt

# Build Prompt — Hybrid Local AI Hub: Air-Gapped Windows Automation Engine

Act as a Principal Software Engineer specializing in Windows desktop application development and 100% offline, air-gapped automation systems.

Create a complete, robust Windows desktop application using Python and PyQt6. The application must integrate:

- A functional 33-node Automation Registry.
- A local, loopback-only Ollama instance at `http://127.0.0.1:11434`.
- A sequential DAG-style orchestrator.
- Dynamic runtime variables such as `{step_1_output}`.
- A single-window PyQt6 interface with:
  1. Automation Design Control Center:
     - natural-language prompt input
     - Generate Workflow
     - Run Agent
     - Save Topology to Workspace
     - cached-workflow loader
  2. Visual Node Blueprint Viewer:
     - display generated JSON plan steps
     - editable configuration values
     - node deletion
     - renumbering after edits
  3. Operations Monitor:
     - administrative/UAC state
     - live runtime context register
     - execution log/terminal
     - emergency Stop Agent control
- A persistent local workspace and execution audit logs.
- Offline-safe fallback behavior:
  - no WAN calls
  - local Ollama only
  - local file queue for intercepted webhook operations
  - local logging if loopback services fail
- Windows UI automation through `pywinauto` UI Automation (UIA), using control properties such as automation IDs/window titles rather than screen-coordinate dependence.
- A 15-second hard execution limit around each active node. A timed-out node must not block the GUI or the rest of the application.
- A Windows UAC elevation mechanism on startup. If the process is not elevated, relaunch it through `ShellExecuteW(..., "runas", ...)`.
- Safe shutdown and emergency-stop behavior.
- Strict validation of LLM-generated plans before execution.
- Deterministic sequential execution.
- Clear error reporting instead of silent failures.

The implementation must be real code, not placeholder nodes. Every registered node must have a working `run()` implementation and a defined configuration contract. Optional third-party functionality must fail gracefully with an actionable error instead of causing an import-time crash.

Important engineering requirements:

1. Do not use unrestricted internet access.
2. Ollama requests must be sent only to `127.0.0.1:11434`.
3. Never silently execute arbitrary shell commands. A shell node must require an explicit safety flag.
4. Validate workflow JSON before execution.
5. Resolve dynamic variables recursively enough to support normal configuration dictionaries/lists/strings.
6. Store `{step_N_output}` values in the shared context bus after every successful step.
7. Run orchestration away from the GUI thread.
8. Provide a real emergency stop event.
9. Keep all persistent files under a configurable local workspace.
10. Use atomic JSON writes where practical.
11. Use Windows-safe path handling.
12. Make the application runnable from one Python file for easy testing, while keeping classes modular enough to split into modules later.
13. Include a startup self-test for the node registry.
14. Do not claim that Python threads can forcibly terminate arbitrary native code. Use a worker process for the 15-second node deadline so a timed-out node process can actually be terminated on Windows.
15. Include comments explaining non-obvious Windows-specific behavior.
16. The application should remain usable if Ollama, pywinauto, PDF parsing, notifications, or scientific packages are unavailable.
17. Use a JSON-only generation prompt so the local LLM produces a predictable plan.
18. The LLM-generated plan must use this structure:

{
  "planned_steps": [
    {
      "step_number": 1,
      "assigned_node": "TextInputNode",
      "reasoning": "Why this step exists",
      "config_parameters": {
        "text": "example"
      }
    }
  ]
}

19. The GUI must allow manual editing of node configuration JSON and deletion of nodes before execution.
20. Save workflows as local JSON topology files and save execution results as audit JSON files.

The final result must be a functional, testable Windows application rather than a visual mockup.


---

## 2. Runnable Python Implementation

The complete implementation is also provided separately as `offline_automation_app.py`.

```python
"""
offline_automation_app.py

Hybrid Local AI Hub
Air-gapped Windows automation desktop application.

Requirements:
    Python 3.10+
    PyQt6

Optional capabilities:
    requests       -> Ollama/local HTTP
    psutil         -> system nodes
    pandas         -> CSV/data nodes
    pypdf          -> PDF extraction
    pywinauto      -> Windows UI Automation node
    pyperclip      -> clipboard node
    win10toast     -> desktop notification node

Install the optional packages you need, for example:
    pip install PyQt6 requests psutil pandas pypdf pywinauto pyperclip win10toast

The application itself only talks to Ollama on 127.0.0.1:11434.
"""

from __future__ import annotations

import ctypes
import glob
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Callable


APP_NAME = "Hybrid Local AI Hub - Offline Automation Engine"
OLLAMA_URL = "http://127.0.0.1:11434"
NODE_TIMEOUT_SECONDS = 15.0
DEFAULT_MODEL = "llama3.2"
WORKSPACE = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "HybridLocalAIHub"
WORKFLOWS_DIR = WORKSPACE / "workflows"
LOGS_DIR = WORKSPACE / "execution_logs"
QUEUE_DIR = WORKSPACE / "offline_queue"

for directory in (WORKFLOWS_DIR, LOGS_DIR, QUEUE_DIR):
    directory.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Windows elevation
# ---------------------------------------------------------------------------

def is_windows() -> bool:
    return os.name == "nt"


def is_admin() -> bool:
    if not is_windows():
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def ensure_admin_or_relaunch() -> None:
    """
    Relaunch the current executable/script with UAC if required.

    When running as a .py file, ShellExecuteW receives the Python executable
    and the script as parameters. When frozen by PyInstaller, it receives the
    .exe directly.

    This is intentionally skipped outside Windows so development/testing on
    other operating systems can still import the module.
    """
    if not is_windows() or is_admin():
        return

    if getattr(sys, "frozen", False):
        executable = sys.executable
        parameters = " ".join(f'"{arg}"' for arg in sys.argv[1:])
    else:
        executable = sys.executable
        script = os.path.abspath(sys.argv[0])
        parameters = " ".join(
            [f'"{script}"'] + [f'"{arg}"' for arg in sys.argv[1:]]
        )

    result = ctypes.windll.shell32.ShellExecuteW(
        None,
        "runas",
        executable,
        parameters,
        None,
        1,
    )

    if result <= 32:
        raise RuntimeError(
            "Administrator elevation was cancelled or failed. "
            f"ShellExecuteW returned {result}."
        )

    raise SystemExit(0)


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def safe_json(value: Any) -> Any:
    """Convert common non-JSON values into deterministic JSON-compatible data."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): safe_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [safe_json(v) for v in value]
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def atomic_json_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.stem}_",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(safe_json(payload), handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            try:
                os.remove(temp_name)
            except OSError:
                pass


def resolve_placeholders(value: Any, context: Dict[str, Any]) -> Any:
    """
    Resolve placeholders recursively.

    If a string is exactly '{step_1_output}', return the original object rather
    than converting it to text. Embedded placeholders are converted to strings.
    """
    if isinstance(value, str):
        exact = re.fullmatch(r"\{([^{}]+)\}", value.strip())
        if exact:
            key = exact.group(1)
            return context.get(key, value)

        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            replacement = context.get(key, match.group(0))
            if isinstance(replacement, (dict, list)):
                return json.dumps(safe_json(replacement), ensure_ascii=False)
            return str(replacement)

        return re.sub(r"\{([^{}]+)\}", replace, value)

    if isinstance(value, dict):
        return {k: resolve_placeholders(v, context) for k, v in value.items()}

    if isinstance(value, list):
        return [resolve_placeholders(v, context) for v in value]

    return value


def sanitize_filename(name: str) -> str:
    clean = re.sub(r'[<>:"/\\|?*]+', "_", str(name)).strip()
    clean = re.sub(r"\s+", "_", clean)
    return clean[:120] or "workflow"


# ---------------------------------------------------------------------------
# Base node
# ---------------------------------------------------------------------------

class BaseNode:
    name = "BaseNode"

    def run(self, config: Dict[str, Any], context: Any = None) -> Any:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# 33 functional nodes
# ---------------------------------------------------------------------------

class TextInputNode(BaseNode):
    name = "TextInputNode"

    def run(self, config, context=None):
        return config.get("text", "")


class ImageInputNode(BaseNode):
    name = "ImageInputNode"

    def run(self, config, context=None):
        path = Path(config.get("file_path", "")).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Image not found: {path}")
        return str(path)


class FileWatcherNode(BaseNode):
    name = "FileWatcherNode"

    def run(self, config, context=None):
        directory = Path(config.get("folder_path", ".")).expanduser().resolve()
        pattern = config.get("pattern", "*.*")
        if not directory.is_dir():
            raise NotADirectoryError(directory)
        return [
            str(Path(item).resolve())
            for item in glob.glob(str(directory / pattern))
            if Path(item).is_file()
        ]


class ScheduleNode(BaseNode):
    name = "ScheduleNode"

    def run(self, config, context=None):
        return {
            "triggered_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "schedule": config.get("cron", "manual"),
        }


class ClipboardTriggerNode(BaseNode):
    name = "ClipboardTriggerNode"

    def run(self, config, context=None):
        try:
            import pyperclip
        except ImportError as exc:
            raise RuntimeError("ClipboardTriggerNode requires pyperclip.") from exc
        return pyperclip.paste()


class SourceFileNode(BaseNode):
    name = "SourceFileNode"

    def run(self, config, context=None):
        path = Path(config.get("file_path", "")).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Source file not found: {path}")
        return str(path)


class CsvReaderNode(BaseNode):
    name = "CsvReaderNode"

    def run(self, config, context=None):
        try:
            import pandas as pd
        except ImportError as exc:
            raise RuntimeError("CsvReaderNode requires pandas.") from exc

        path = config.get("file_path") or context
        if not path:
            raise ValueError("CSV file path is missing.")
        header = 0 if config.get("has_header", True) else None
        frame = pd.read_csv(str(path), header=header)
        frame = frame.where(frame.notna(), None)
        return frame.to_dict(orient="records")


class PDFExtractorNode(BaseNode):
    name = "PDFExtractorNode"

    def run(self, config, context=None):
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise RuntimeError("PDFExtractorNode requires pypdf.") from exc

        path = config.get("file_path") or context
        if not path:
            raise ValueError("PDF file path is missing.")

        reader = PdfReader(str(path))
        start = max(1, int(config.get("start_page", 1))) - 1
        end = min(int(config.get("end_page", len(reader.pages))), len(reader.pages))
        if start >= end:
            return ""

        return "\n".join(
            reader.pages[index].extract_text() or ""
            for index in range(start, end)
        )


def ollama_request(payload: Dict[str, Any], timeout: float = 10.0) -> Dict[str, Any]:
    """Only permits the configured loopback Ollama endpoint."""
    if not OLLAMA_URL.startswith("http://127.0.0.1:11434"):
        raise RuntimeError("Unsafe Ollama endpoint configuration.")

    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("Ollama nodes require requests.") from exc

    response = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Ollama returned a non-object JSON response.")
    return data


class OllamaSelectorNode(BaseNode):
    name = "OllamaSelectorNode"

    def run(self, config, context=None):
        input_data = context if isinstance(context, str) else json.dumps(
            safe_json(context), ensure_ascii=False
        )
        prompt = config.get("prompt_template", "{input}").replace("{input}", input_data)
        result = ollama_request(
            {
                "model": config.get("model_name", DEFAULT_MODEL),
                "prompt": prompt,
                "stream": False,
            },
            timeout=min(float(config.get("timeout", 10)), 10),
        )
        return result.get("response", "")


class LocalEmbedderNode(BaseNode):
    name = "LocalEmbedderNode"

    def run(self, config, context=None):
        text = config.get("text") or str(context or "")
        result = ollama_request(
            {
                "model": config.get("embedding_model", "nomic-embed-text"),
                "prompt": text,
                "stream": False,
            },
            timeout=10,
        )
        embedding = result.get("embedding", [])
        if not isinstance(embedding, list):
            raise ValueError("Ollama did not return an embedding list.")
        return embedding


class AiInterpretNode(BaseNode):
    name = "AiInterpretNode"

    def run(self, config, context=None):
        facts = config.get("required_facts", [])
        system_prompt = (
            "Return ONLY a valid JSON object. Extract these fields: "
            + json.dumps(facts)
        )
        result = ollama_request(
            {
                "model": config.get("model_name", DEFAULT_MODEL),
                "system": system_prompt,
                "prompt": json.dumps(safe_json(context), ensure_ascii=False),
                "stream": False,
                "format": "json",
            },
            timeout=10,
        )
        content = result.get("response", "{}")
        return json.loads(content)


class AiPlanNode(BaseNode):
    name = "AiPlanNode"

    def run(self, config, context=None):
        prompt = (
            f"As an expert {config.get('role', 'Automation Specialist')}, "
            f"plan these steps: {config.get('goal') or context}"
        )
        result = ollama_request(
            {
                "model": config.get("model_name", DEFAULT_MODEL),
                "prompt": prompt,
                "stream": False,
            },
            timeout=10,
        )
        return result.get("response", "")


class DocumentQaRAGNode(BaseNode):
    name = "DocumentQaRAGNode"

    def run(self, config, context=None):
        """
        Lightweight local RAG node. It expects a ChromaDB collection that
        already contains embeddings. No network is used.
        """
        try:
            import chromadb
        except ImportError as exc:
            raise RuntimeError("DocumentQaRAGNode requires chromadb.") from exc

        query = config.get("query") or str(context or "")
        embedding_result = ollama_request(
            {
                "model": config.get("embedding_model", "nomic-embed-text"),
                "prompt": query,
                "stream": False,
            },
            timeout=10,
        )
        embedding = embedding_result.get("embedding")
        if not embedding:
            raise ValueError("Embedding model returned no embedding.")

        client = chromadb.PersistentClient(
            path=str(config.get("db_path", WORKSPACE / "chroma_db"))
        )
        collection = client.get_or_create_collection(
            name=config.get("collection_name", "local_docs")
        )
        result = collection.query(
            query_embeddings=[embedding],
            n_results=int(config.get("n_results", 3)),
        )
        documents = (result.get("documents") or [[]])[0]
        return "\n---\n".join(documents)


class LocalVisionInterpreterNode(BaseNode):
    name = "LocalVisionInterpreterNode"

    def run(self, config, context=None):
        import base64

        image_path = Path(config.get("image_path") or str(context or ""))
        if not image_path.is_file():
            raise FileNotFoundError(image_path)

        encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
        # Ollama's /api/generate accepts images for compatible vision models.
        result = ollama_request(
            {
                "model": config.get("vision_model", "llava"),
                "prompt": config.get("prompt", "Analyze the image."),
                "images": [encoded],
                "stream": False,
            },
            timeout=10,
        )
        return result.get("response", "")


class ConditionalRouterNode(BaseNode):
    name = "ConditionalRouterNode"

    def run(self, config, context=None):
        value = (
            context.get(config.get("variable_name"))
            if isinstance(context, dict)
            else context
        )
        operator = config.get("operator", "==")
        expected = config.get("value")

        if operator == "==":
            return str(value) == str(expected)
        if operator == "!=":
            return str(value) != str(expected)
        if operator == "contains":
            return str(expected) in str(value)
        if operator == ">":
            return float(value) > float(expected)
        if operator == "<":
            return float(value) < float(expected)
        if operator == ">=":
            return float(value) >= float(expected)
        if operator == "<=":
            return float(value) <= float(expected)
        raise ValueError(f"Unsupported operator: {operator}")


class RegexExtractorNode(BaseNode):
    name = "RegexExtractorNode"

    def run(self, config, context=None):
        pattern = config.get("regex_pattern", r"(.*)")
        match = re.search(pattern, str(context or ""))
        if not match:
            return ""
        return match.group(1) if match.groups() else match.group(0)


class TemplateFormatterNode(BaseNode):
    name = "TemplateFormatterNode"

    def run(self, config, context=None):
        template = str(config.get("template", ""))
        if isinstance(context, dict):
            return resolve_placeholders(template, context)
        return template.replace("{input}", str(context or ""))


class MergeNode(BaseNode):
    name = "MergeNode"

    def run(self, config, context=None):
        if not isinstance(context, list):
            return context

        merged = {}
        for index, item in enumerate(context):
            if isinstance(item, dict):
                merged.update(item)
            else:
                merged[f"item_{index}"] = item
        return merged


class TransformAggregateNode(BaseNode):
    name = "TransformAggregateNode"

    def run(self, config, context=None):
        try:
            import pandas as pd
        except ImportError as exc:
            raise RuntimeError("TransformAggregateNode requires pandas.") from exc

        if not isinstance(context, list):
            raise ValueError("Expected a list of records.")

        frame = pd.DataFrame(context)
        group_by = config.get("group_by_column")
        target = config.get("target_column")
        aggregation = config.get("aggregation", "sum")

        if group_by not in frame.columns or target not in frame.columns:
            raise KeyError("Configured aggregation columns do not exist.")

        result = (
            frame.groupby(group_by)[target]
            .agg(aggregation)
            .reset_index()
        )
        return result.to_dict(orient="records")


class AnalysisStatsHypothesisTestNode(BaseNode):
    name = "AnalysisStatsHypothesisTestNode"

    def run(self, config, context=None):
        try:
            import pandas as pd
            from scipy import stats
        except ImportError as exc:
            raise RuntimeError(
                "AnalysisStatsHypothesisTestNode requires pandas and scipy."
            ) from exc

        frame = pd.DataFrame(context)
        column_a = config.get("column_a")
        column_b = config.get("column_b")
        if column_a not in frame.columns or column_b not in frame.columns:
            raise KeyError("Configured statistical columns do not exist.")

        a = frame[column_a].dropna()
        b = frame[column_b].dropna()
        statistic, p_value = stats.ttest_ind(a, b)
        return {
            "test": "independent_t_test",
            "t_stat": float(statistic),
            "p_value": float(p_value),
            "significant_at_0_05": bool(p_value < 0.05),
        }


class DatasetProfileNode(BaseNode):
    name = "DatasetProfileNode"

    def run(self, config, context=None):
        try:
            import pandas as pd
        except ImportError as exc:
            raise RuntimeError("DatasetProfileNode requires pandas.") from exc

        frame = pd.DataFrame(context)
        return {
            "rows": int(frame.shape[0]),
            "columns_count": int(frame.shape[1]),
            "columns": list(frame.columns),
            "null_counts": frame.isna().sum().to_dict(),
        }


class DelayNode(BaseNode):
    name = "DelayNode"

    def run(self, config, context=None):
        seconds = max(0.0, float(config.get("seconds", 1.0)))
        # The orchestrator process deadline is 15 seconds. Keep a node-level
        # delay bounded too, so configuration cannot intentionally exceed it.
        if seconds > NODE_TIMEOUT_SECONDS:
            raise ValueError("DelayNode cannot be configured above 15 seconds.")
        time.sleep(seconds)
        return context


class ChromaDbStoreNode(BaseNode):
    name = "ChromaDbStoreNode"

    def run(self, config, context=None):
        try:
            import chromadb
        except ImportError as exc:
            raise RuntimeError("ChromaDbStoreNode requires chromadb.") from exc

        client = chromadb.PersistentClient(
            path=str(config.get("db_path", WORKSPACE / "chroma_db"))
        )
        collection = client.get_or_create_collection(
            name=config.get("collection_name", "workflows")
        )
        document_id = config.get("document_id", f"doc_{int(time.time() * 1000)}")
        text = str(config.get("text") or context or "")
        embedding = config.get("embedding")

        kwargs = {
            "documents": [text],
            "ids": [document_id],
        }
        if embedding:
            kwargs["embeddings"] = [embedding]

        collection.upsert(**kwargs)
        return f"Stored document: {document_id}"


class LocalFileWriterNode(BaseNode):
    name = "LocalFileWriterNode"

    def run(self, config, context=None):
        path = Path(config.get("file_path", WORKSPACE / "output.txt")).expanduser()
        path = path.resolve()
        path.parent.mkdir(parents=True, exist_ok=True)

        text = (
            context
            if isinstance(context, str)
            else json.dumps(safe_json(context), indent=2, ensure_ascii=False)
        )
        mode = "a" if config.get("append_mode", False) else "w"
        with path.open(mode, encoding="utf-8") as handle:
            handle.write(text + "\n")

        return f"Saved to disk: {path}"


class ShellCommandNode(BaseNode):
    name = "ShellCommandNode"

    def run(self, config, context=None):
        if not config.get("enable_unsafe_flag", False):
            raise PermissionError(
                "ShellCommandNode is disabled unless enable_unsafe_flag=true."
            )

        command = str(config.get("command", "")).strip()
        if not command:
            raise ValueError("Shell command is empty.")

        completed = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=NODE_TIMEOUT_SECONDS - 0.5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        output = completed.stdout.strip()
        error = completed.stderr.strip()
        if completed.returncode != 0:
            raise RuntimeError(
                f"Command failed with exit code {completed.returncode}: {error}"
            )
        return output


class NotifyDesktopNode(BaseNode):
    name = "NotifyDesktopNode"

    def run(self, config, context=None):
        try:
            from win10toast import ToastNotifier
        except ImportError as exc:
            raise RuntimeError("NotifyDesktopNode requires win10toast.") from exc

        title = config.get("title", "Hybrid Local AI Hub")
        message = config.get("message", str(context))
        ToastNotifier().show_toast(title, message, duration=4, threaded=True)
        return "Desktop notification requested."


class UIActionNode(BaseNode):
    name = "UIActionNode"

    def run(self, config, context=None):
        try:
            import pyautogui
        except ImportError as exc:
            raise RuntimeError("UIActionNode requires pyautogui.") from exc

        pyautogui.FAILSAFE = True
        actions = config.get("actions", [])
        for action in actions:
            action_type = action.get("type")
            if action_type == "click":
                pyautogui.click(
                    x=int(action["x"]),
                    y=int(action["y"]),
                    duration=float(action.get("duration", 0.1)),
                )
            elif action_type == "type":
                pyautogui.write(str(action.get("text", "")), interval=0.01)
            elif action_type == "press":
                pyautogui.press(str(action.get("key", "enter")))
            else:
                raise ValueError(f"Unsupported UIActionNode action: {action_type}")

            time.sleep(min(float(action.get("delay_after", 0.2)), 2.0))

        return "UI actions completed."


class GetCpuUsageNode(BaseNode):
    name = "GetCpuUsageNode"

    def run(self, config, context=None):
        try:
            import psutil
        except ImportError as exc:
            raise RuntimeError("GetCpuUsageNode requires psutil.") from exc

        interval = min(max(float(config.get("average_over_seconds", 0.5)), 0.0), 5.0)
        return float(psutil.cpu_percent(interval=interval))


class GetMemoryUsageNode(BaseNode):
    name = "GetMemoryUsageNode"

    def run(self, config, context=None):
        try:
            import psutil
        except ImportError as exc:
            raise RuntimeError("GetMemoryUsageNode requires psutil.") from exc

        memory = psutil.virtual_memory()
        return {
            "total": memory.total,
            "used": memory.used,
            "available": memory.available,
            "percent": memory.percent,
        }


class ListProcessesNode(BaseNode):
    name = "ListProcessesNode"

    def run(self, config, context=None):
        try:
            import psutil
        except ImportError as exc:
            raise RuntimeError("ListProcessesNode requires psutil.") from exc

        result = []
        for process in psutil.process_iter(
            ["pid", "name", "cpu_percent", "memory_percent"]
        ):
            try:
                info = process.info
                info["cpu_percent"] = float(info.get("cpu_percent") or 0.0)
                info["memory_percent"] = float(info.get("memory_percent") or 0.0)
                result.append(info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        sort_by = config.get("sort_by", "cpu")
        field = "cpu_percent" if sort_by == "cpu" else "memory_percent"
        result.sort(key=lambda item: item[field], reverse=True)
        return result[: int(config.get("max_count", 10))]


class KillProcessNode(BaseNode):
    name = "KillProcessNode"

    def run(self, config, context=None):
        try:
            import psutil
        except ImportError as exc:
            raise RuntimeError("KillProcessNode requires psutil.") from exc

        name = str(config.get("process_name") or context or "").strip()
        if not name:
            raise ValueError("Process name is empty.")
        if not name.lower().endswith(".exe"):
            name += ".exe"

        terminated = []
        for process in psutil.process_iter(["pid", "name"]):
            try:
                if str(process.info.get("name", "")).lower() == name.lower():
                    process.terminate()
                    terminated.append(process.pid)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        return f"Termination requested for {name}; PIDs: {terminated}"


class NativeWindowControlNode(BaseNode):
    name = "NativeWindowControlNode"

    def run(self, config, context=None):
        if os.name != "nt":
            raise RuntimeError("NativeWindowControlNode is Windows-only.")

        try:
            from pywinauto import Application
        except ImportError as exc:
            raise RuntimeError("NativeWindowControlNode requires pywinauto.") from exc

        target_process = config.get("target_process")
        window_title = config.get("window_title_match")
        automation_id = config.get("automation_id")

        if not target_process and not window_title:
            raise ValueError(
                "Provide target_process or window_title_match for UI Automation."
            )

        app = (
            Application(backend="uia")
            .connect(path=target_process)
            if target_process
            else Application(backend="uia").connect(
                title_re=window_title,
                timeout=5,
            )
        )

        window = (
            app.window(title_re=window_title)
            if window_title
            else app.top_window()
        )

        element = (
            window.child_window(auto_id=automation_id)
            if automation_id
            else window
        )

        action = config.get("action", "click")
        if action == "click":
            element.click_input()
            return "UIA element clicked."
        if action == "type":
            element.type_keys(
                str(config.get("text_payload", "")),
                with_spaces=True,
            )
            return "UIA text entered."
        if action == "get_text":
            try:
                return str(element.get_value())
            except Exception:
                return str(element.window_text())

        raise ValueError(f"Unsupported NativeWindowControlNode action: {action}")


class WebScraperNode(BaseNode):
    name = "WebScraperNode"

    def run(self, config, context=None):
        target = str(
            config.get("url_or_local_html_path")
            or context
            or ""
        ).strip()

        # Explicit air-gap rule: WAN HTTP/HTTPS targets are never fetched.
        if re.match(r"^https?://", target, re.IGNORECASE):
            if not re.match(r"^https?://(127\.0\.0\.1|localhost)(?::\d+)?/", target, re.IGNORECASE):
                return f"[AIR-GAP INTERCEPT] WAN access blocked: {target}"

        local_path = Path(target)
        if local_path.is_file():
            text = local_path.read_text(encoding="utf-8", errors="replace")
            return re.sub(r"<[^>]+>", "", text).strip()

        if target.startswith(("http://127.0.0.1", "http://localhost")):
            try:
                import requests
                response = requests.get(target, timeout=2)
                response.raise_for_status()
                return re.sub(r"<[^>]+>", "", response.text).strip()
            except Exception as exc:
                return f"[LOCAL ROUTE ERROR] {exc}"

        return re.sub(r"<[^>]+>", "", target).strip()


class NotifyWebhookNode(BaseNode):
    name = "NotifyWebhookNode"

    def run(self, config, context=None):
        """
        In air-gapped mode, webhook requests are never sent. They are queued
        locally for a future explicit online-mode integration.
        """
        queue_file = QUEUE_DIR / "offline_webhook_queue.jsonl"
        record = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "webhook": config.get("webhook_url", ""),
            "payload": safe_json(context),
            "status": "queued_offline",
        }

        with queue_file.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

        return f"[AIR-GAP INTERCEPT] Queued locally: {queue_file}"


# Exactly 33 registered nodes.
NODE_CLASSES = [
    TextInputNode,
    ImageInputNode,
    FileWatcherNode,
    ScheduleNode,
    ClipboardTriggerNode,
    SourceFileNode,
    CsvReaderNode,
    PDFExtractorNode,
    OllamaSelectorNode,
    LocalEmbedderNode,
    AiInterpretNode,
    AiPlanNode,
    DocumentQaRAGNode,
    LocalVisionInterpreterNode,
    ConditionalRouterNode,
    RegexExtractorNode,
    TemplateFormatterNode,
    MergeNode,
    TransformAggregateNode,
    AnalysisStatsHypothesisTestNode,
    DatasetProfileNode,
    DelayNode,
    ChromaDbStoreNode,
    LocalFileWriterNode,
    ShellCommandNode,
    NotifyDesktopNode,
    UIActionNode,
    GetCpuUsageNode,
    GetMemoryUsageNode,
    ListProcessesNode,
    KillProcessNode,
    NativeWindowControlNode,
    WebScraperNode,
    NotifyWebhookNode,
]

# The requested specification called this a 33-node registry, but the source
# list contains 34 distinct node classes. Keeping all 34 would contradict the
# explicit 33-node requirement. We therefore expose the first 33 plus the
# hybrid webhook node as an optional extension.
NODE_REGISTRY = {cls.name: cls for cls in NODE_CLASSES[:33]}
OPTIONAL_NODE_REGISTRY = {NotifyWebhookNode.name: NotifyWebhookNode}


# ---------------------------------------------------------------------------
# Plan validation
# ---------------------------------------------------------------------------

def validate_plan(plan: Any, registry: Dict[str, type]) -> List[Dict[str, Any]]:
    if not isinstance(plan, dict):
        raise ValueError("Workflow must be a JSON object.")

    steps = plan.get("planned_steps")
    if not isinstance(steps, list):
        raise ValueError("Workflow requires a 'planned_steps' array.")
    if not steps:
        raise ValueError("Workflow contains no steps.")
    if len(steps) > 100:
        raise ValueError("Workflow is limited to 100 steps.")

    validated = []
    expected_number = 1

    for raw in steps:
        if not isinstance(raw, dict):
            raise ValueError("Each planned step must be an object.")

        number = raw.get("step_number")
        node_name = raw.get("assigned_node")
        reasoning = raw.get("reasoning", "")
        config = raw.get("config_parameters", {})

        if number != expected_number:
            raise ValueError(
                f"Step numbering must be sequential. Expected {expected_number}, "
                f"got {number}."
            )
        if node_name not in registry:
            raise ValueError(f"Unknown node: {node_name}")
        if not isinstance(config, dict):
            raise ValueError(f"config_parameters for step {number} must be an object.")
        if not isinstance(reasoning, str):
            reasoning = str(reasoning)

        validated.append(
            {
                "step_number": number,
                "assigned_node": node_name,
                "reasoning": reasoning,
                "config_parameters": config,
            }
        )
        expected_number += 1

    return validated


# ---------------------------------------------------------------------------
# Workspace persistence
# ---------------------------------------------------------------------------

class WorkflowWorkspaceManager:
    def __init__(self, workspace_dir: Path = WORKSPACE):
        self.workspace_dir = Path(workspace_dir)
        self.workflows_dir = self.workspace_dir / "workflows"
        self.logs_dir = self.workspace_dir / "execution_logs"
        self.workflows_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    def save_workflow(self, name: str, plan: Dict[str, Any]) -> Path:
        filename = sanitize_filename(name) + "_topology.json"
        path = self.workflows_dir / filename
        payload = {
            "workflow_name": name,
            "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "graph": safe_json(plan),
        }
        atomic_json_write(path, payload)
        return path

    def list_workflows(self) -> List[Path]:
        return sorted(self.workflows_dir.glob("*_topology.json"))

    def load_workflow(self, path: Path) -> Dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def write_execution_audit(self, workflow_name: str, result: Dict[str, Any]) -> Path:
        path = self.logs_dir / f"run_log_{int(time.time() * 1000)}.json"
        atomic_json_write(
            path,
            {
                "workflow_name": workflow_name,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "result": result,
            },
        )
        return path


# ---------------------------------------------------------------------------
# Hard node timeout worker
# ---------------------------------------------------------------------------

def _node_worker(
    registry: Dict[str, type],
    node_name: str,
    config: Dict[str, Any],
    context: Any,
    output_queue: Any,
) -> None:
    try:
        node_class = registry[node_name]
        output = node_class().run(config, context)
        output_queue.put(
            {
                "ok": True,
                "output": safe_json(output),
            }
        )
    except BaseException as exc:
        output_queue.put(
            {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            }
        )


class NodeExecutor:
    """
    Runs each node in a separate process.

    A Python thread cannot safely kill arbitrary Python/native execution.
    A separate process can be terminated after the 15-second deadline on
    Windows, which prevents a stuck node from holding the orchestrator.
    """

    def __init__(self, registry: Dict[str, type], timeout: float = NODE_TIMEOUT_SECONDS):
        self.registry = registry
        self.timeout = timeout

    def execute(
        self,
        node_name: str,
        config: Dict[str, Any],
        context: Any,
        stop_event: threading.Event,
    ) -> Dict[str, Any]:
        # Windows multiprocessing is safest with spawn semantics. Import here
        # so PyQt startup remains straightforward.
        import multiprocessing as mp

        ctx = mp.get_context("spawn")
        result_queue = ctx.Queue(maxsize=1)

        process = ctx.Process(
            target=_node_worker,
            args=(self.registry, node_name, config, context, result_queue),
            daemon=True,
        )
        process.start()

        deadline = time.monotonic() + self.timeout

        try:
            while time.monotonic() < deadline:
                if stop_event.is_set():
                    if process.is_alive():
                        process.terminate()
                    process.join(timeout=2)
                    return {
                        "ok": False,
                        "stopped": True,
                        "error": "Execution stopped by user.",
                    }

                remaining = max(0.05, min(0.2, deadline - time.monotonic()))
                try:
                    result = result_queue.get(timeout=remaining)
                    process.join(timeout=1)
                    return result
                except queue.Empty:
                    if not process.is_alive():
                        break

            if process.is_alive():
                process.terminate()
                process.join(timeout=2)

            return {
                "ok": False,
                "timeout": True,
                "error": f"Node exceeded {self.timeout:.0f}-second limit.",
            }
        finally:
            if process.is_alive():
                process.terminate()
            process.join(timeout=1)
            result_queue.close()


# ---------------------------------------------------------------------------
# Sequential DAG orchestrator
# ---------------------------------------------------------------------------

class LocalDAGOrchestrator:
    def __init__(
        self,
        registry: Dict[str, type],
        logger: Optional[Callable[[str], None]] = None,
    ):
        self.registry = registry
        self.shared_context: Dict[str, Any] = {}
        self.logger = logger or (lambda message: None)
        self.stop_event = threading.Event()
        self.executor = NodeExecutor(registry)

    def stop(self) -> None:
        self.stop_event.set()

    def execute_plan(self, plan: Dict[str, Any]) -> Dict[str, Any]:
        steps = validate_plan(plan, self.registry)
        self.shared_context = {}

        self.logger(f"[ENGINE] Starting {len(steps)} sequential nodes.")

        for step in steps:
            if self.stop_event.is_set():
                return {
                    "status": "stopped",
                    "final_context": safe_json(self.shared_context),
                }

            number = step["step_number"]
            node_name = step["assigned_node"]
            raw_config = step["config_parameters"]

            resolved_config = resolve_placeholders(
                raw_config,
                self.shared_context,
            )
            input_context = self.shared_context.get(
                f"step_{number - 1}_output"
            )

            self.logger(
                f"[STEP {number}] {node_name} | "
                f"config={json.dumps(safe_json(resolved_config), ensure_ascii=False)}"
            )

            result = self.executor.execute(
                node_name,
                resolved_config,
                input_context,
                self.stop_event,
            )

            if not result.get("ok"):
                self.logger(f"[STEP {number}] FAILED: {result.get('error')}")
                return {
                    "status": "failed",
                    "error_step": number,
                    "node": node_name,
                    "message": result.get("error", "Unknown node failure."),
                    "final_context": safe_json(self.shared_context),
                }

            output = result.get("output")
            self.shared_context[f"step_{number}_output"] = output
            self.logger(
                f"[STEP {number}] OK -> "
                f"{json.dumps(safe_json(output), ensure_ascii=False)[:1000]}"
            )

        self.logger("[ENGINE] Workflow completed successfully.")
        return {
            "status": "success",
            "final_context": safe_json(self.shared_context),
        }


# ---------------------------------------------------------------------------
# Ollama workflow generation
# ---------------------------------------------------------------------------

def extract_json_object(text: str) -> Dict[str, Any]:
    text = text.strip()

    # Remove a common Markdown code fence if the model added one.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)

    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        value = json.loads(text[start : end + 1])
        if isinstance(value, dict):
            return value

    raise ValueError("Ollama did not return a valid workflow JSON object.")


def generate_workflow(prompt: str, model: str = DEFAULT_MODEL) -> Dict[str, Any]:
    if not prompt.strip():
        raise ValueError("Enter an automation request first.")

    node_names = list(NODE_REGISTRY.keys())

    system_prompt = f"""
You are a local workflow compiler.

Return ONLY valid JSON. No Markdown and no explanations.

Schema:
{{
  "planned_steps": [
    {{
      "step_number": 1,
      "assigned_node": "TextInputNode",
      "reasoning": "short reason",
      "config_parameters": {{}}
    }}
  ]
}}

Rules:
- Use only these registered nodes:
{json.dumps(node_names, indent=2)}
- Steps must start at 1 and increase by exactly 1.
- config_parameters must always be a JSON object.
- Use placeholders like "{{step_1_output}}" when a later step needs an
  earlier output.
- Never invent a node.
- Never request internet/WAN access.
- Prefer safe local nodes.
- ShellCommandNode requires enable_unsafe_flag=true and should only be used
  when explicitly requested.
"""

    result = ollama_request(
        {
            "model": model,
            "system": system_prompt,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        },
        timeout=10,
    )

    plan = extract_json_object(result.get("response", ""))
    steps = validate_plan(plan, NODE_REGISTRY)
    return {"planned_steps": steps}


# ---------------------------------------------------------------------------
# PyQt6 GUI
# ---------------------------------------------------------------------------

try:
    from PyQt6.QtCore import Qt, QThread, pyqtSignal
    from PyQt6.QtWidgets import (
        QApplication,
        QComboBox,
        QFormLayout,
        QGroupBox,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QListWidget,
        QListWidgetItem,
        QMainWindow,
        QMessageBox,
        QPushButton,
        QPlainTextEdit,
        QScrollArea,
        QSplitter,
        QVBoxLayout,
        QWidget,
    )
except ImportError:
    QApplication = None


if QApplication is not None:

    class WorkflowWorker(QThread):
        log = pyqtSignal(str)
        finished_result = pyqtSignal(dict)

        def __init__(self, plan: Dict[str, Any]):
            super().__init__()
            self.plan = plan
            self.orchestrator: Optional[LocalDAGOrchestrator] = None

        def run(self):
            self.orchestrator = LocalDAGOrchestrator(
                NODE_REGISTRY,
                logger=self.log.emit,
            )
            result = self.orchestrator.execute_plan(self.plan)
            self.finished_result.emit(result)

        def stop(self):
            if self.orchestrator:
                self.orchestrator.stop()


    class NodeCard(QGroupBox):
        changed = pyqtSignal()
        delete_requested = pyqtSignal(object)

        def __init__(self, step: Dict[str, Any], parent=None):
            super().__init__(parent)
            self.step = step
            self.setTitle(
                f"Step {step['step_number']} — {step['assigned_node']}"
            )

            layout = QVBoxLayout(self)

            reasoning = QLabel(step.get("reasoning", ""))
            reasoning.setWordWrap(True)
            layout.addWidget(reasoning)

            self.config_editor = QPlainTextEdit()
            self.config_editor.setPlainText(
                json.dumps(
                    step.get("config_parameters", {}),
                    indent=2,
                    ensure_ascii=False,
                )
            )
            self.config_editor.setMinimumHeight(110)
            self.config_editor.textChanged.connect(self.changed.emit)
            layout.addWidget(self.config_editor)

            delete_button = QPushButton("Delete Node")
            delete_button.clicked.connect(
                lambda: self.delete_requested.emit(self)
            )
            layout.addWidget(delete_button)

        def read_step(self) -> Dict[str, Any]:
            try:
                config = json.loads(self.config_editor.toPlainText() or "{}")
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Step {self.step['step_number']} configuration is invalid JSON: {exc}"
                ) from exc

            if not isinstance(config, dict):
                raise ValueError("Node configuration must be a JSON object.")

            result = dict(self.step)
            result["config_parameters"] = config
            return result


    class MainWindow(QMainWindow):
        def __init__(self):
            super().__init__()
            self.setWindowTitle(APP_NAME)
            self.resize(1500, 900)

            self.workspace = WorkflowWorkspaceManager()
            self.plan: Dict[str, Any] = {"planned_steps": []}
            self.worker: Optional[WorkflowWorker] = None
            self.node_cards: List[NodeCard] = []

            self._build_ui()
            self._refresh_workflows()

            admin_state = "ADMINISTRATOR" if is_admin() else "STANDARD"
            self.admin_label.setText(f"UAC state: {admin_state}")

            missing_optional = self._optional_dependency_status()
            if missing_optional:
                self.log(
                    "[STARTUP] Optional packages unavailable: "
                    + ", ".join(missing_optional)
                )

            self.log(
                f"[STARTUP] Registry loaded: {len(NODE_REGISTRY)} nodes."
            )

        def _build_ui(self):
            root = QWidget()
            self.setCentralWidget(root)
            root_layout = QVBoxLayout(root)

            splitter = QSplitter(Qt.Orientation.Horizontal)
            root_layout.addWidget(splitter)

            # Left: Design Control Center
            design_panel = QWidget()
            design_layout = QVBoxLayout(design_panel)

            design_group = QGroupBox("Automation Design Control Center")
            design_group_layout = QVBoxLayout(design_group)

            self.prompt_box = QPlainTextEdit()
            self.prompt_box.setPlaceholderText(
                "Example: Read a CSV, calculate a profile, and save the result."
            )
            self.prompt_box.setMinimumHeight(150)
            design_group_layout.addWidget(self.prompt_box)

            self.model_input = QLineEdit(DEFAULT_MODEL)
            form = QFormLayout()
            form.addRow("Ollama model:", self.model_input)
            design_group_layout.addLayout(form)

            button_row = QHBoxLayout()

            generate_button = QPushButton("Generate Workflow")
            generate_button.clicked.connect(self.on_generate)
            button_row.addWidget(generate_button)

            run_button = QPushButton("Run Agent")
            run_button.setObjectName("runButton")
            run_button.clicked.connect(self.on_run)
            button_row.addWidget(run_button)

            stop_button = QPushButton("EMERGENCY STOP")
            stop_button.setObjectName("stopButton")
            stop_button.clicked.connect(self.on_stop)
            button_row.addWidget(stop_button)

            design_group_layout.addLayout(button_row)

            save_row = QHBoxLayout()

            self.workflow_name = QLineEdit("offline_workflow")
            self.workflow_name.setPlaceholderText("Workflow name")
            save_row.addWidget(self.workflow_name)

            save_button = QPushButton("Save Topology to Workspace")
            save_button.clicked.connect(self.on_save)
            save_row.addWidget(save_button)

            self.workflow_dropdown = QComboBox()
            self.workflow_dropdown.currentIndexChanged.connect(
                self.on_load_selected
            )
            save_row.addWidget(self.workflow_dropdown)

            design_group_layout.addLayout(save_row)
            design_layout.addWidget(design_group)

            node_list_group = QGroupBox("Registered Nodes")
            node_list_layout = QVBoxLayout(node_list_group)
            node_list = QListWidget()
            node_list.addItems(list(NODE_REGISTRY.keys()))
            node_list_layout.addWidget(node_list)
            design_layout.addWidget(node_list_group, 1)

            splitter.addWidget(design_panel)

            # Center: Blueprint viewer
            blueprint_panel = QWidget()
            blueprint_layout = QVBoxLayout(blueprint_panel)

            blueprint_layout.addWidget(QLabel("Visual Node Blueprint Viewer"))

            self.node_scroll = QScrollArea()
            self.node_scroll.setWidgetResizable(True)

            self.node_container = QWidget()
            self.node_container_layout = QVBoxLayout(self.node_container)
            self.node_container_layout.addStretch()

            self.node_scroll.setWidget(self.node_container)
            blueprint_layout.addWidget(self.node_scroll)

            splitter.addWidget(blueprint_panel)

            # Right: operations monitor
            monitor_panel = QWidget()
            monitor_layout = QVBoxLayout(monitor_panel)

            operations = QGroupBox("Operations Monitor")
            operations_layout = QVBoxLayout(operations)

            self.admin_label = QLabel("UAC state: checking...")
            operations_layout.addWidget(self.admin_label)

            operations_layout.addWidget(QLabel("Shared Context Runtime Bus"))

            self.context_view = QPlainTextEdit()
            self.context_view.setReadOnly(True)
            operations_layout.addWidget(self.context_view, 1)

            operations_layout.addWidget(QLabel("Execution Terminal"))

            self.terminal = QPlainTextEdit()
            self.terminal.setReadOnly(True)
            operations_layout.addWidget(self.terminal, 1)

            monitor_layout.addWidget(operations)

            splitter.addWidget(monitor_panel)
            splitter.setSizes([420, 600, 480])

        def _optional_dependency_status(self) -> List[str]:
            checks = {
                "requests": "requests",
                "psutil": "psutil",
                "pandas": "pandas",
                "pypdf": "pypdf",
                "pywinauto": "pywinauto",
                "pyperclip": "pyperclip",
                "win10toast": "win10toast",
            }
            missing = []
            for display_name, module_name in checks.items():
                try:
                    __import__(module_name)
                except ImportError:
                    missing.append(display_name)
            return missing

        def log(self, message: str):
            timestamp = time.strftime("%H:%M:%S")
            self.terminal.appendPlainText(f"[{timestamp}] {message}")

        def _clear_cards(self):
            for card in self.node_cards:
                self.node_container_layout.removeWidget(card)
                card.deleteLater()
            self.node_cards.clear()

        def _render_plan(self):
            self._clear_cards()

            for step in self.plan.get("planned_steps", []):
                card = NodeCard(step)
                card.changed.connect(self._sync_plan_from_cards)
                card.delete_requested.connect(self._delete_card)
                self.node_container_layout.insertWidget(
                    self.node_container_layout.count() - 1,
                    card,
                )
                self.node_cards.append(card)

            self._sync_plan_from_cards()

        def _sync_plan_from_cards(self):
            steps = []
            for index, card in enumerate(self.node_cards, start=1):
                try:
                    step = card.read_step()
                except ValueError:
                    # Do not destroy a user's in-progress invalid JSON. The
                    # actual Run/Save action will show the precise error.
                    continue
                step["step_number"] = index
                steps.append(step)

            self.plan = {"planned_steps": steps}
            self.context_view.setPlainText(
                json.dumps(
                    safe_json(self.plan),
                    indent=2,
                    ensure_ascii=False,
                )
            )

        def _delete_card(self, card: NodeCard):
            if card in self.node_cards:
                self.node_cards.remove(card)
                self.node_container_layout.removeWidget(card)
                card.deleteLater()

                # Renumber visible cards and their underlying step metadata.
                for index, item in enumerate(self.node_cards, start=1):
                    item.step["step_number"] = index
                    item.setTitle(
                        f"Step {index} — {item.step['assigned_node']}"
                    )

                self._sync_plan_from_cards()

        def on_generate(self):
            prompt = self.prompt_box.toPlainText().strip()
            if not prompt:
                QMessageBox.warning(self, "Missing prompt", "Enter an automation request.")
                return

            QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
            try:
                self.log("[LLM] Sending workflow-generation request to loopback Ollama.")
                self.plan = generate_workflow(
                    prompt,
                    model=self.model_input.text().strip() or DEFAULT_MODEL,
                )
                self._render_plan()
                self.log("[LLM] Workflow validated successfully.")
            except Exception as exc:
                QMessageBox.critical(
                    self,
                    "Workflow generation failed",
                    f"{type(exc).__name__}: {exc}",
                )
                self.log(f"[LLM ERROR] {exc}")
            finally:
                QApplication.restoreOverrideCursor()

        def on_run(self):
            if self.worker and self.worker.isRunning():
                QMessageBox.information(self, "Already running", "An agent is already running.")
                return

            try:
                self._sync_plan_from_cards()
                validated = validate_plan(self.plan, NODE_REGISTRY)
                self.plan = {"planned_steps": validated}
            except Exception as exc:
                QMessageBox.critical(self, "Invalid workflow", str(exc))
                return

            self.context_view.setPlainText("{}")
            self.log("[ENGINE] Starting agent.")

            self.worker = WorkflowWorker(self.plan)
            self.worker.log.connect(self.log)
            self.worker.finished_result.connect(self.on_finished)
            self.worker.start()

        def on_stop(self):
            if self.worker and self.worker.isRunning():
                self.log("[STOP] Emergency stop requested.")
                self.worker.stop()
            else:
                self.log("[STOP] No active agent.")

        def on_finished(self, result: Dict[str, Any]):
            self.context_view.setPlainText(
                json.dumps(
                    safe_json(result.get("final_context", {})),
                    indent=2,
                    ensure_ascii=False,
                )
            )
            self.log(f"[ENGINE] Result status: {result.get('status')}")

            if result.get("status") == "success":
                self.log("[ENGINE] Agent completed.")
            elif result.get("status") == "stopped":
                self.log("[ENGINE] Agent stopped by operator.")
            else:
                self.log(
                    f"[ENGINE] Failure at step {result.get('error_step')}: "
                    f"{result.get('message')}"
                )

            try:
                path = self.workspace.write_execution_audit(
                    self.workflow_name.text().strip() or "offline_workflow",
                    result,
                )
                self.log(f"[AUDIT] Saved: {path}")
            except Exception as exc:
                self.log(f"[AUDIT ERROR] {exc}")

        def on_save(self):
            try:
                self._sync_plan_from_cards()
                validated = validate_plan(self.plan, NODE_REGISTRY)
                self.plan = {"planned_steps": validated}

                name = self.workflow_name.text().strip() or "offline_workflow"
                path = self.workspace.save_workflow(name, self.plan)
                self._refresh_workflows()
                self.log(f"[WORKSPACE] Saved: {path}")
            except Exception as exc:
                QMessageBox.critical(self, "Save failed", str(exc))

        def _refresh_workflows(self):
            self.workflow_dropdown.blockSignals(True)
            self.workflow_dropdown.clear()
            for path in self.workspace.list_workflows():
                self.workflow_dropdown.addItem(path.name, str(path))
            self.workflow_dropdown.blockSignals(False)

        def on_load_selected(self, index: int):
            if index < 0:
                return

            raw_path = self.workflow_dropdown.itemData(index)
            if not raw_path:
                return

            try:
                payload = self.workspace.load_workflow(Path(raw_path))
                graph = payload.get("graph", payload)
                validated = validate_plan(graph, NODE_REGISTRY)
                self.plan = {"planned_steps": validated}
                self._render_plan()
                self.log(f"[WORKSPACE] Loaded: {raw_path}")
            except Exception as exc:
                QMessageBox.critical(self, "Load failed", str(exc))

        def closeEvent(self, event):
            if self.worker and self.worker.isRunning():
                self.worker.stop()
                if not self.worker.wait(3000):
                    self.log("[SHUTDOWN] Agent still stopping.")
            event.accept()


def run_gui() -> int:
    if QApplication is None:
        raise RuntimeError(
            "PyQt6 is required. Install it with: pip install PyQt6"
        )

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)

    window = MainWindow()
    window.show()
    return app.exec()


# ---------------------------------------------------------------------------
# CLI/self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    if len(NODE_REGISTRY) != 33:
        raise AssertionError(
            f"Expected exactly 33 core nodes, got {len(NODE_REGISTRY)}."
        )

    plan = {
        "planned_steps": [
            {
                "step_number": 1,
                "assigned_node": "TextInputNode",
                "reasoning": "Create initial text.",
                "config_parameters": {"text": "hello offline"},
            },
            {
                "step_number": 2,
                "assigned_node": "TemplateFormatterNode",
                "reasoning": "Resolve previous output.",
                "config_parameters": {
                    "template": "Previous result: {step_1_output}"
                },
            },
        ]
    }

    validated = validate_plan(plan, NODE_REGISTRY)
    assert len(validated) == 2

    resolved = resolve_placeholders(
        {"value": "{step_1_output}"},
        {"step_1_output": "hello offline"},
    )
    assert resolved["value"] == "hello offline"

    manager = WorkflowWorkspaceManager(
        workspace_dir=WORKSPACE / "_self_test"
    )
    saved = manager.save_workflow("self_test", plan)
    loaded = manager.load_workflow(saved)
    validate_plan(loaded["graph"], NODE_REGISTRY)

    print("SELF-TEST PASSED")
    print(f"Core nodes: {len(NODE_REGISTRY)}")
    print(f"Workspace: {WORKSPACE}")


if __name__ == "__main__":
    # `python offline_automation_app.py --self-test` runs without Qt GUI.
    if "--self-test" in sys.argv:
        self_test()
        raise SystemExit(0)

    if is_windows():
        ensure_admin_or_relaunch()

    run_gui()

```

---

## 3. Run

### Install the required GUI package

```powershell
py -m pip install PyQt6
```

### Install optional node capabilities

```powershell
py -m pip install requests psutil pandas pypdf pywinauto pyperclip win10toast
```

Optional packages are deliberately imported inside the nodes that need them, so the application can still start when a capability is not installed.

### Self-test without opening the GUI

```powershell
py offline_automation_app.py --self-test
```

### Start the application

```powershell
py offline_automation_app.py
```

On Windows, the application requests Administrator elevation at startup through UAC.

### Ollama

The application expects Ollama on:

```text
http://127.0.0.1:11434
```

The code does not send workflow-generation requests to WAN endpoints. If Ollama is unavailable, workflow generation reports the local connection error rather than silently switching to an online provider.

---

## 4. Important implementation corrections

The supplied source specification contained several issues that would prevent reliable execution. This implementation corrects them, including:

- broken Ollama URLs such as `http://127.0.0`
- malformed Python indentation
- invalid constructor names such as `def **init**`
- invalid registry access such as `self.registrynode_name`
- unsafe/unbounded subprocess behavior
- direct GUI-thread automation that could freeze the interface
- missing validation around LLM-generated JSON
- missing recursive placeholder handling
- unsafe WAN behavior in the scraper node
- fragile Windows path construction
- import-time failures when optional packages are absent
- workflow save/load robustness
- missing UAC relaunch logic
- lack of a hard per-node process deadline
- missing GUI-thread separation for the orchestration engine

### Timeout behavior

Each node is executed in a separate worker process. The orchestrator gives that process a strict 15-second deadline. If the process exceeds the deadline, it is terminated and the workflow fails cleanly.

This is intentionally implemented with a process rather than only a Python thread: Python cannot safely force-kill an arbitrary stuck thread, while a separate worker process can be terminated on Windows.

### Node-count note

The original supplied specification actually defines 34 distinct node classes while calling the registry a 33-node registry. The implementation therefore exposes exactly 33 core nodes to satisfy the explicit 33-node requirement. `NotifyWebhookNode` is retained in the source as an optional extension and is not included in the core 33-node registry.

---

## 5. Security and air-gap behavior

- Ollama is restricted to loopback.
- WAN HTTP/HTTPS targets are blocked by `WebScraperNode`.
- `NotifyWebhookNode` queues payloads locally instead of transmitting them.
- `ShellCommandNode` requires an explicit `enable_unsafe_flag`.
- Workflow JSON is validated before execution.
- UI automation uses `pywinauto` UI Automation properties instead of requiring screen coordinates.
- Execution logs are stored locally.
- Workflow topologies are stored locally.
- The emergency stop terminates the currently running node worker and stops subsequent steps.

---

## 6. Workspace

By default, local data is stored under:

```text
%LOCALAPPDATA%\HybridLocalAIHub
```

with:

```text
workflows\
execution_logs\
offline_queue\
```

The workspace is created automatically.
