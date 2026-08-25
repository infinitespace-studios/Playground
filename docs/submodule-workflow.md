# MonoGame submodule workflow

Clone the playground and all nested submodules recursively:

```bash
git clone --recursive <playground-repository-url>
```

Initialize or update submodules in an existing clone:

```bash
git submodule update --init --recursive
```

From the repository root, use the validator for the canonical local and CI
submodule health check:

```bash
./scripts/validate-submodule.sh
```

On Windows:

```powershell
.\scripts\validate-submodule.ps1
```

The validator checks that `external/MonoGame` is populated, pinned to the
manifest commit, clean, and reachable from the manifest's protected ref.
