import json, urllib.request
d = json.loads(urllib.request.urlopen("http://localhost:8000/openapi.json").read())
for k in sorted(d["paths"]):
    print(k)
