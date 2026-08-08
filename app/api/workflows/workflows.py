from pathlib import Path

import yaml
from fastapi import APIRouter

router = APIRouter(prefix="/workflows", tags=["workflows"])

_WORKFLOW_DIRS = [
    Path(__file__).parent.parent.parent.parent / "config" / "workflows",
    Path(__file__).parent.parent.parent.parent / "workflows",
]


def _load_workflow_file(f: Path) -> dict:
    with open(f, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return {
        "name": data.get("name", f.stem),
        "display_name": data.get("display_name", data.get("name", f.stem)),
        "description": data.get("description", ""),
        "icon": data.get("icon", ""),
        "category": data.get("category", "content"),
        "version": data.get("version", "1.0"),
        "file": f.name,
        "steps": len(data.get("steps", [])),
        "step_details": [
            {
                "id": s.get("id", s.get("name", "")),
                "display_name": s.get("display_name", s.get("name", "")),
                "agent": s.get("agent", ""),
                "human_review": s.get("human_review", False),
            }
            for s in data.get("steps", [])
        ],
    }


@router.get("")
async def list_workflows():
    seen_names: set = set()
    workflows = []
    for wf_dir in _WORKFLOW_DIRS:
        if not wf_dir.exists():
            continue
        for f in sorted(wf_dir.glob("*.yaml")):
            try:
                wf = _load_workflow_file(f)
                if wf["name"] not in seen_names:
                    seen_names.add(wf["name"])
                    workflows.append(wf)
            except Exception:
                pass
    return {"status": "success", "data": {"workflows": workflows}}
