import urllib.request, json

# Test 1: Empty intent
data = json.dumps({"intent": "", "persona": "neg"}).encode()
req = urllib.request.Request("http://127.0.0.1:8000/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=5)
    print(f"EMPTY: HTTP {r.status} (BUG! should be 422)")
except urllib.error.HTTPError as e:
    print(f"EMPTY: HTTP {e.code} (correct!)")

# Test 2: No intent at all
data2 = json.dumps({"persona": "neg2"}).encode()
req2 = urllib.request.Request("http://127.0.0.1:8000/api/v1/tasks", data=data2, headers={"Content-Type": "application/json"})
try:
    r2 = urllib.request.urlopen(req2, timeout=5)
    print(f"NO INTENT: HTTP {r2.status} (BUG! should be 422)")
except urllib.error.HTTPError as e:
    print(f"NO INTENT: HTTP {e.code} (correct!)")

# Test 3: Invalid mode
data3 = json.dumps({"intent": "test", "persona": "neg3", "mode": "bad_mode"}).encode()
req3 = urllib.request.Request("http://127.0.0.1:8000/api/v1/tasks", data=data3, headers={"Content-Type": "application/json"})
try:
    r3 = urllib.request.urlopen(req3, timeout=5)
    print(f"BAD MODE: HTTP {r3.status} (BUG! should be 422)")
except urllib.error.HTTPError as e:
    print(f"BAD MODE: HTTP {e.code} (correct!)")
