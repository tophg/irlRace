---
description: how to push code to the remote repository
---

## Push Workflow

// turbo-all

1. Stage and commit all changes:
```
cd /Users/devnull/irlRace && git add -A && git commit -m "<descriptive commit message>"
```

2. Push to the **dev** remote (irlRace-DEV) only:
```
cd /Users/devnull/irlRace && git push dev main
```

> **Important:** Always push to the `dev` remote (`https://github.com/tophg/irlRace-DEV`), NOT `origin`. Only push to `origin` if the user explicitly requests it.
