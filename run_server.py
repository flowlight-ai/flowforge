import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uvicorn
from app.main import app

uvicorn.run(app, host="127.0.0.1", port=8000)
