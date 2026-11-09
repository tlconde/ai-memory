---
id: "01M6ZW07786JWRWTBVMRGDVDA7"
about: "confsvc loadConfig"
evidence: []
verified: false
seen: 0
origin: "session"
---
loadConfig could fall back to config.example.json when config.json is missing, and should resolve the path from import.meta.url rather than the working directory. Not tried yet.
