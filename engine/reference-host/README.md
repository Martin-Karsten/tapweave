# Pinned upstream reference host skeleton

This project references the upstream checkout directly; it never references the C# spike. Builds verify both clean checkout commits and the vendored source manifest. The framework package is pinned by upstream `osu.Game.csproj`.

Set `OSU_REFERENCE_CHECKOUT` and `OSU_FRAMEWORK_CHECKOUT` to clean checkouts at the revisions in `../reference/source-manifest.json`. Use the upstream SDK/workload requirements, then run:

```sh
node engine/scripts/verify-sources.mjs --require-checkouts
dotnet restore engine/reference-host/ReferenceHost.csproj
```

The first reviewed restore must commit `packages.lock.json`; subsequent oracle runs must use `dotnet restore --locked-mode`. No lock file is fabricated from an unperformed restore.

The host intentionally exits with `EXPERIMENT_ADAPTERS_REQUIRED`. Remaining work is to wire actual decoder/default/control-point observations for H01/H02 into the shared trace schema, record provenance, and compare outputs. A successfully compiled skeleton is not an upstream compatibility result. Neither restore nor execution has been validated yet.
