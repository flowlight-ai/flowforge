import os
import yaml
from fastapi import APIRouter
from pathlib import Path

router = APIRouter(prefix="/workflows", tags=["workflows"])

@router.get("")
async def list_workflows():
    wf_dir = Path(__file__).parent.parent.parent.parent / "workflows"
    workflows = []
    if wf_dir.exists():
        for f in wf_dir.glob("*.yaml"):
            with open(f, "r", encoding="utf-8") as fh:
                data = yaml.safe_load(fh)
                workflows.append({"name": data.get("name", f.stem), "file": f.name, "steps": len(data.get("steps", []))})
    return {"status": "success", "data": {"workflows": workflows}}
