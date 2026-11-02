# Previous installation proof stability

Pinning proof files only during a single read, then comparing the manifest body across later checks, missed a changed key and re-authenticated envelope with the same body. A fixture reproduced publication despite the changed proof state.

When a prior proof must remain stable throughout a multi-step installation, compare a private in-memory fingerprint of both the authenticated envelope and its key across checks, and verify file identity and metadata while reading. Never print or persist the key or its fingerprint. This detects observed changes; it does not protect state from commands running as the same account.
